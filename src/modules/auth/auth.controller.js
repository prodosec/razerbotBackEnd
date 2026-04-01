const authService = require('./auth.service');
const User = require('./user.model');
const { chromium } = require('playwright');

let homepageBrowser;
let homepagePage;

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

async function submitRazerLogin(email, password) {
  if (!homepagePage) {
    return null;
  }

  const emailInput = homepagePage.locator('#input-login-email');
  const passwordInput = homepagePage.locator('#input-login-password');
  const loginButton = homepagePage.locator('#btn-log-in');

  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.fill(email);
  await emailInput.dispatchEvent('input');
  await emailInput.dispatchEvent('change');

  await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
  await homepagePage.evaluate((passwordValue) => {
    const passwordField = document.querySelector('#input-login-password');
    if (!passwordField) {
      return;
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
  }, password);

  await homepagePage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);

  await homepagePage.evaluate(() => {
    const submitButton = document.querySelector('#btn-log-in');
    if (submitButton) {
      submitButton.removeAttribute('disabled');
    }
  });
  await loginButton.click();

  await homepagePage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);

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
    return alertText || null;
  } catch (error) {
    return null;
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



async function login(req, res, next) {
  try {
    // const result = await authService.login(req.body);
    let result = {};
    const razerLoginError = await submitRazerLogin(req.body.email, req.body.password);
    result.razerLoginError = razerLoginError;
    res.status(400).json(result);
  } catch (err) {
    next(err);
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
    if (req.user) await authService.revoke(req.user.id || req.user._id);
    res.json({ message: 'Logged out' });
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
