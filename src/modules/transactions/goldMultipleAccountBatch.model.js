const mongoose = require('mongoose');

const goldMultipleAccountBatchSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    jobId: { type: String, required: true },
    mode: { type: String, required: true },
    total: { type: Number, required: true },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    accounts: { type: [String], default: [] },
    perAccountConcurrency: { type: Number, default: 3 },
    pausedAccounts: { type: [String], default: [] },
    stoppedAccounts: { type: [String], default: [] },
    proxyPool: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    completedAt: { type: Date, required: true },
    transactions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GoldMultipleAccountBatch', goldMultipleAccountBatchSchema);
