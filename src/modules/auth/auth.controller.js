const authService = require('./auth.service');
const User = require('./user.model');
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
    const result = await authService.login(req.body);
    res.status(200).json(result);
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
  me,
  refresh,
  logout,
  redirectToRazer,
  razerCallback,
};
