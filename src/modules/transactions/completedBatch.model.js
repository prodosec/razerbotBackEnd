const mongoose = require('mongoose');

const completedBatchSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    jobId: { type: String, required: true },
    mode: { type: String, required: true },
    total: { type: Number, required: true },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    completedAt: { type: Date, required: true },
    transactions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CompletedBatch', completedBatchSchema);
