const authService = require('./auth.service');
const User = require('./user.model');
const { chromium } = require('playwright');

let homepageBrowser;
let homepagePage;

const DEFAULT_RAZER_GOLD_URL = process.env.RAZER_GOLD_URL || 'https://gold.razer.com/pk/en';

function parseJwtPayload(token) {
  try {
    const [, payload] = token.split('.');
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch (error) {
    return null;
  }
}

async function fillFirstVisible(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.waitFor({ state: 'visible', timeout: 3000 });
        await locator.fill(value);
        return true;
      } catch (error) {
        // Try the next selector.
      }
    }
  }

  return false;
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.waitFor({ state: 'visible', timeout: 3000 });
        await locator.click();
        return true;
      } catch (error) {
        // Try the next selector.
      }
    }
  }

  return false;
}

async function enableAndSubmitLogin(page) {
  const submitSelectors = [
    '#btn-log-in',
    'button.login-btn-landscape',
    'button[type="submit"]',
    'input[type="submit"]',
  ];

  await page.evaluate((selectors) => {
    selectors.forEach((selector) => {
      const submitButton = document.querySelector(selector);
      if (!submitButton) {
        return;
      }

      submitButton.removeAttribute('disabled');
      submitButton.disabled = false;
    });
  }, submitSelectors);

  const submitted = await clickFirstVisible(page, submitSelectors);
  if (!submitted) {
    throw {
      status: 400,
      message: 'Unable to find a visible login submit button after filling the form.',
    };
  }
}

async function handlePostLoginPrompts(page) {
  const acceptButton = page.locator('#btn-accept').first();
  const skipButton = page.locator('#btn-skip').first();

  await Promise.race([
    acceptButton.waitFor({ state: 'visible', timeout: 5000 }).then(() => acceptButton.click()),
    skipButton.waitFor({ state: 'visible', timeout: 5000 }).then(() => skipButton.click()),
  ]).catch(() => null);

  await page.waitForLoadState('load', { timeout: 5000 }).catch(() => null);
}

async function captureRazerIdAuthToken(page) {
  try {
    const request = await page.waitForRequest((req) => {
      const headers = req.headers();
      return (
        req.url().includes('razerid.razer.com') &&
        Boolean(headers['authorization'])
      );
    }, { timeout: 10000 }).catch(() => null);

    const authHeader = request?.headers?.()?.['authorization'] || '';
    console.log('Captured razerid authorization token:', authHeader);
    return authHeader;
  } catch (err) {
    console.warn('Could not capture razerid auth token:', err.message);
    return '';
  }
}

async function captureGoldPayload(page) {
  const goldUrl = DEFAULT_RAZER_GOLD_URL;
  const goldRequestPromise = page.waitForRequest((request) => {
    const headers = request.headers();
    const url = request.url();

    return (
      url.includes('gold.razer.com/api/') &&
      Boolean(headers['x-razer-accesstoken'])
    );
  }, { timeout: 20000 }).catch(() => null);

  try {
    await page.goto(goldUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
  } catch (error) {
    if (error?.message?.includes('ERR_NAME_NOT_RESOLVED')) {
      throw {
        status: 502,
        message: `Unable to resolve Razer Gold host while opening ${goldUrl}. Check DNS/network access on the server or set RAZER_GOLD_URL to a reachable Razer Gold page.`,
      };
    }

    if (error?.message?.includes('ETIMEDOUT') || error?.code === 'ETIMEDOUT') {
      console.warn(`[captureGoldPayload] Connection to ${goldUrl} timed out — continuing with partial data.`);
    } else {
      console.warn(`[captureGoldPayload] Could not fully load ${goldUrl}: ${error.message}`);
    }
  }
  // Wait for the gold API request (with auth headers) and page load in parallel
  const [goldRequest] = await Promise.all([
    goldRequestPromise,
    page.waitForLoadState('load', { timeout: 10000 }).catch(() => null),
  ]);

  // Poll until the key cookies are actually written by JS (max 10s)
  let contextCookies = [];
  const cookieDeadline = Date.now() + 10000;
  do {
    contextCookies = await page.context().cookies();
    const hasRzru = contextCookies.some((c) => c.name === '_rzru');
    const hasAccessToken =
      goldRequest?.headers?.()?.['x-razer-accesstoken'] ||
      contextCookies.some((c) => c.name.toLowerCase().includes('token'));
    if (hasRzru && hasAccessToken) break;
    await new Promise((r) => setTimeout(r, 400));
  } while (Date.now() < cookieDeadline);

  const rawHeaders = goldRequest?.headers?.() || {};
  const cookieHeader = contextCookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const rzruCookie = contextCookies.find((cookie) => cookie.name === '_rzru');
  const rzruPayload = rzruCookie ? parseJwtPayload(rzruCookie.value) : null;
  const usernameFromCookie =
    rzruPayload?.ext?.razerid ||
    rzruPayload?.ext?.nickname ||
    null;

  return {
    goldUrl,
    cookieHeader,
    cookies: contextCookies,
    xRazerAccessToken: rawHeaders['x-razer-accesstoken'] || '',
    xRazerFpid: rawHeaders['x-razer-fpid'] || '',
    xRazerRazerid: rawHeaders['x-razer-razerid'] || rzruPayload?.sub || rzruPayload?.ext?.uuid || '',
    rawHeaders,
    usernameFromCookie,
  };
}

async function submitRazerLogin(email, password, onLoginDetected) {
  if (!homepagePage) {
    throw {
      status: 400,
      message: 'Homepage is not initialized. Open /api/auth/homepage before submitting login.',
    };
  }

  const emailSelectors = [
    '#input-login-email',
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
  ];
  const passwordSelectors = [
    '#input-login-password',
    'input[type="password"]',
    'input[name="password"]',
  ];

  const emailFilled = await fillFirstVisible(homepagePage, emailSelectors, email);
  if (!emailFilled) {
    throw {
      status: 400,
      message: 'Unable to find the email field on the Razer login form.',
    };
  }

  const passwordFilled = await homepagePage.evaluate(({ selectors, passwordValue }) => {
    for (const selector of selectors) {
      const passwordField = document.querySelector(selector);
      if (!passwordField) {
        continue;
      }

      passwordField.removeAttribute('readonly');
      passwordField.readOnly = false;

      const prototype = Object.getPrototypeOf(passwordField);
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (valueSetter) {
        valueSetter.call(passwordField, passwordValue);
      } else {
        passwordField.value = passwordValue;
      }

      passwordField.dispatchEvent(new Event('input', { bubbles: true }));
      passwordField.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  }, { selectors: passwordSelectors, passwordValue: password });

  if (!passwordFilled) {
    throw {
      status: 400,
      message: 'Unable to find the password field on the Razer login form.',
    };
  }

  await homepagePage.waitForLoadState('load', { timeout: 5000 }).catch(() => null);
  const razerIdAuthTokenPromise = captureRazerIdAuthToken(homepagePage);
  await enableAndSubmitLogin(homepagePage);

  await homepagePage.waitForLoadState('load', { timeout: 5000 }).catch(() => null);

  const alertBox = homepagePage.locator('#main-alert.show.error.notification .dialog').first();
  try {
    await alertBox.waitFor({ state: 'visible', timeout: 3000 });
    const alertText = await homepagePage.evaluate(() => {
      const dialog = document.querySelector('#main-alert.show.error.notification .dialog');
      if (!dialog) {
        return null;
      }

      const dialogClone = dialog.cloneNode(true);
      const removeButton = dialogClone.querySelector('.btn-remove');
      if (removeButton) {
        removeButton.remove();
      }

      return dialogClone.textContent?.trim() || null;
    });
    return {
      success: false,
      message: alertText || 'Login failed',
    };
  } catch (error) {
    await handlePostLoginPrompts(homepagePage);

    const username = await homepagePage.evaluate(() => {
      const nameNode = document.querySelector('.userinfo .userinfo-name p');
      return nameNode?.textContent?.trim() || null;
    });
    console.log('Logged in username detected on homepage:', username);

    // Notify caller that login is confirmed — before slow gold navigation
    if (onLoginDetected) {
      await onLoginDetected();
    }

    // Capture the razerid.razer.com authorization bearer token (used for OTP service)
    const razerIdAuthToken = await razerIdAuthTokenPromise;

    const goldPayload = await captureGoldPayload(homepagePage);
    const finalUsername = username || goldPayload.usernameFromCookie || email;

    return {
      success: true,
      message: 'Logged in successfully',
      name: finalUsername,
      email,
      password,
      payload: {
        referer: goldPayload.goldUrl,
        currentUrl: homepagePage.url(),
        cookieHeader: goldPayload.cookieHeader,
        cookies: goldPayload.cookies,
        xRazerAccessToken: goldPayload.xRazerAccessToken,
        xRazerFpid: goldPayload.xRazerFpid,
        xRazerRazerid: goldPayload.xRazerRazerid,
        razerIdAuthToken,
        rawHeaders: goldPayload.rawHeaders,
      },
    };
  }
}

async function register(req, res, next) {
  try {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}



function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function login(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const razerLoginResult = await submitRazerLogin(
      req.body.email,
      req.body.password,
      () => {
        // Login confirmed — notify frontend immediately so it can show loading screen
        sendSSE(res, 'logged_in', { message: 'Login successful, loading your account...' });
      }
    );

    if (!razerLoginResult?.success) {
      console.log('Razer login failed:', razerLoginResult?.message);
      sendSSE(res, 'error', { success: false, message: razerLoginResult?.message || 'Login failed' });
      return res.end();
    }

    const authResult = await authService.registerRazerBrowserLogin({
      name: razerLoginResult.name || req.body.email,
      email: razerLoginResult.email,
      password: razerLoginResult.password,
    });

    await authService.saveRazerPayloadData({
      userId: authResult.user.id,
      email: authResult.user.email,
      username: authResult.user.name,
      payload: razerLoginResult.payload,
    });

    if (homepageBrowser) {
      await homepageBrowser.close();
      homepageBrowser = null;
      homepagePage = null;
    }

    // All done — send full auth data so frontend can go to dashboard
    sendSSE(res, 'ready', { success: true, ...authResult });
    res.end();
  } catch (err) {
    const message = err?.message || 'Login failed';
    sendSSE(res, 'error', { success: false, message });
    res.end();
  }
}

async function homepage(req, res, next) {
  console.log('Homepage loaded');

  try {
    if (homepageBrowser && homepagePage) {
      await homepagePage.goto('https://razerid.razer.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    } else {
      homepageBrowser = await chromium.launch({ headless: false });
      homepagePage = await homepageBrowser.newPage();
      await homepagePage.goto('https://razerid.razer.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    }

    await homepagePage.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => null);
    await homepagePage.bringToFront();
    console.log('Accept button found');
    const acceptButton = homepagePage.locator('button.cky-btn.cky-btn-accept[data-cky-tag="accept-button"]');
    try {
      await acceptButton.first().waitFor({ state: 'visible', timeout: 5000 });
      await acceptButton.first().click();
    } catch (error) {
      // Cookie banner did not appear within the timeout.
      console.log('Cookie banner not found');
    }

    res.status(200).json({
      message: 'Homepage loaded successfully',
      url: homepagePage.url(),
      title: await homepagePage.title(),
    });
  } catch (err) {
    next(err);
  }
}

async function getLogin(req, res, next) {
  try {
    const result = await authService.getLogin(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    console.log('req.userId', req.userId);
    console.log('req.', req);
    const user = await User.findById(req.userId);

    res.json({
      user
    });

  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const token = req.body.refreshToken || req.cookies.refreshToken;
    if (!token) return res.status(400).json({ message: 'Refresh token required' });
    const tokens = await authService.refresh(token);
    res.json(tokens);
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (userId) {
      await Promise.all([
        authService.revoke(userId),
        authService.clearRazerPayload(userId),
      ]);
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

function redirectToRazer(req, res) {
  console.log('Redirecting to Razer for authentication');
  const redirectUri = encodeURIComponent(process.env.RAZER_CALLBACK_URL);
  const url = `https://oauth2.razer.com/authorize_openid?response_type=code&l=eng&scope=openid+profile+email&client_id=${process.env.RAZER_CLIENT_ID}&state=xyz&redirect_uri=${redirectUri}`;
  res.redirect(url);
}

async function razerCallback(req, res) {
  try {
    const { code } = req.query;
    console.log('Received Razer callback with code:', code);
    if (!code) {
      return res.status(400).json({ message: 'Authorization code is missing' });
    }

    const result = await authService.razerLoginService(code);
    // returning JSON by default; frontend may choose to redirect
    console.log('Razer login successful, user:', result.user);
    res.cookie("auth-token", result.accessToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax"
    });
    return res.redirect(
      `${process.env.FRONT_END_URL}/dashboard`
    );
  } catch (err) {
    console.error('Controller Error:', err.message);
    res.status(500).json({ message: 'Razer login failed' });
  }
}

module.exports = {
  register,
  login,
  homepage,
  me,
  refresh,
  logout,
  redirectToRazer,
  razerCallback,
};
