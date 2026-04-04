const express = require('express');
const cookieParser = require('cookie-parser');
const authRouter = require('./modules/auth/auth.routes');
const gamesRouter = require('./modules/games/games.routes');
const walletRouter = require('./modules/wallet/wallet.routes');
const errorHandler = require('./middleware/errorHandler');
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/games', gamesRouter);
app.use('/api/wallet', walletRouter);

app.use((req, res, next) => {
  res.status(404).json({ message: 'Not Found' });
});

app.use(errorHandler);

module.exports = app;
