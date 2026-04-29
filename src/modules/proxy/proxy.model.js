const mongoose = require('mongoose');

const proxySchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    label: { type: String, required: true },
    country: { type: String, default: '' },
    ip: { type: String, required: true },
    port: { type: String, required: true },
    username: { type: String, default: '' },
    password: { type: String, default: '' },
    dedicated: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Proxy', proxySchema);
