const Proxy = require('./proxy.model');
const { reloadProxies } = require('../../utils/proxyAxios');

async function listProxies(req, res, next) {
  try {
    const proxies = await Proxy.find({}).sort({ id: 1 }).lean();
    return res.json({ success: true, proxies });
  } catch (err) {
    next(err);
  }
}

async function createProxy(req, res, next) {
  try {
    const { id, label, country, ip, port, username, password, dedicated, disabled } = req.body || {};

    if (id == null || !label || !ip || !port) {
      return res.status(400).json({ success: false, message: 'id, label, ip, and port are required' });
    }

    const exists = await Proxy.findOne({ id });
    if (exists) {
      return res.status(409).json({ success: false, message: `Proxy with id ${id} already exists` });
    }

    const proxy = await Proxy.create({
      id, label, country, ip, port, username, password,
      dedicated: !!dedicated,
      disabled: !!disabled,
    });

    await reloadProxies();
    return res.status(201).json({ success: true, proxy });
  } catch (err) {
    next(err);
  }
}

async function updateProxy(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'id must be a number' });
    }

    const allowed = ['label', 'country', 'ip', 'port', 'username', 'password', 'dedicated', 'disabled'];
    const update = {};
    for (const key of allowed) {
      if (key in (req.body || {})) update[key] = req.body[key];
    }

    const proxy = await Proxy.findOneAndUpdate({ id }, { $set: update }, { new: true });
    if (!proxy) {
      return res.status(404).json({ success: false, message: `Proxy ${id} not found` });
    }

    await reloadProxies();
    return res.json({ success: true, proxy });
  } catch (err) {
    next(err);
  }
}

async function deleteProxy(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'id must be a number' });
    }

    const proxy = await Proxy.findOneAndDelete({ id });
    if (!proxy) {
      return res.status(404).json({ success: false, message: `Proxy ${id} not found` });
    }

    await reloadProxies();
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function reload(req, res, next) {
  try {
    const list = await reloadProxies();
    return res.json({ success: true, count: list.length });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listProxies,
  createProxy,
  updateProxy,
  deleteProxy,
  reload,
};
