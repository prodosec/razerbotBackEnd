const jwt = require('jsonwebtoken');

async function auth(req, res, next) {
  try {
    // const authHeader = req.headers.authorization || '';
    // const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    // if (!token) return res.status(401).json({ message: 'Unauthorized' });

    // const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    // const user = await User.findById(payload.sub).select('-password');
    // if (!user) return res.status(401).json({ message: 'Unauthorized' });
    // req.user = user;
    const token = req.cookies['auth-token'];

    if (!token) {
      return res.status(401).json({
        message: "Unauthorized"
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET
    );
    req.userId = decoded.sub;

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        message: 'Unauthorized',
      });
    }

    next(err);
  }
}

module.exports = auth;
