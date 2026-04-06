const mongoose = require('mongoose');

const transactionTestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: String, required: true, index: true },
    itemIndex: { type: Number, required: true },
    status: { type: String, enum: ['success', 'failed'], required: true },
    requestPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    responsePayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    errorMessage: { type: String, default: '' },
    processingMs: { type: Number, default: 0 },
    processedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TransactionBatchTest', transactionTestSchema);
