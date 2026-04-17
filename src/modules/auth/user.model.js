const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    first_name: { type: String, default: '' },
    last_name: { type: String, default: '' },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    userPassword: { type: String },
    email_verified: { type: String },
    refresh_token_razer: { type: String },
    accessToken_razer: { type: String },
    refreshToken: { type: String },
    open_id: { type: String },
    provider: { type: String, enum: ['local', 'razer'], default: 'local' },
    proxyId: { type: Number, default: null },
  },
  { timestamps: true }
);

const registeredUser = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    first_name: { type: String, default: '' },
    last_name: { type: String, default: '' },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    status: { type: String, default: 'active' },
    refresh_token_razer: { type: String },
    accessToken_razer: { type: String },
    refreshToken: { type: String },
    open_id: { type: String },
    provider: { type: String, enum: ['local', 'razer'], default: 'local' },
    proxyId: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
module.exports = mongoose.model('RegisteredUser', registeredUser);
