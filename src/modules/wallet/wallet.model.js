const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    gold: { type: Number, default: 0 },
    currency: { type: Number, default: 0 },
    razer_gold_balance: { type: Number, default: 0 },
    razer_currency_balance: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wallet', walletSchema);
