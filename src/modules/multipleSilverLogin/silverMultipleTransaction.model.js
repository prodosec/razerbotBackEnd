const mongoose = require('mongoose');

const silverMultipleTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'RegisteredUser', required: true },
    country: { type: String, default: 'United States' },
    product: { type: mongoose.Schema.Types.Mixed, required: true },
    total: { type: Number, required: true },
    redeemed: { type: Number, default: 0 },
    receiptsOk: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    elapsed: { type: String },
    phase1Elapsed: { type: String },
    proxiesUsed: { type: [String], default: [] },
    results: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SilverMultipleTransaction', silverMultipleTransactionSchema);
