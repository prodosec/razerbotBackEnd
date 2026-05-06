const crypto = require('crypto');
const { emitTransactionEvent } = require('./transactions.events');
const { getProxyMeta } = require('../../utils/proxyAxios');

const MAX_CONCURRENCY = 10;
const ALLOWED_MODES = new Set(['fake', 'mongodb', 'razer']);

class TransactionsManager {
  constructor() {
    this.jobs = new Map();
  }

  createJob({ userId, transactions, concurrency, mode, processFn, onCompletedFn }) {
    const normalizedConcurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(concurrency) || 1));
    const normalizedMode = ALLOWED_MODES.has(mode) ? mode : 'fake';

    const jobId = crypto.randomUUID();
    const queue = transactions.map((payload, index) => ({
      itemId: `${jobId}-${index}`,
      index,
      payload,
    }));

    const job = {
      id: jobId,
      userId,
      mode: normalizedMode,
      status: 'running',
      concurrency: normalizedConcurrency,
      queue,
      activeCount: 0,
      paused: false,
      stopRequested: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: new Date(),
      endedAt: null,
      total: queue.length,
      counts: {
        unprocessed: queue.length,
        running: 0,
        success: 0,
        reviewing: 0,
        failed: 0,
      },
      processFn,
      onCompletedFn: onCompletedFn || null,
      lastResults: [],
      multiAccount: false,
    };

    this.jobs.set(jobId, job);

    this.emit(job, 'transactions:started', {
      message: 'Batch job started',
    });

    this.pump(jobId);

    return this.buildPublicJob(job);
  }

  createMultiJob({ userId, accounts, perAccountConcurrency, mode, proxyPool, processFn, onCompletedFn }) {
    const perAccount = Math.max(1, Math.min(MAX_CONCURRENCY, Number(perAccountConcurrency) || 3));
    const normalizedMode = ALLOWED_MODES.has(mode) ? mode : 'fake';
    const usePool = Array.isArray(proxyPool) && proxyPool.length > 0;

    const jobId = crypto.randomUUID();

    const accountEmails = accounts.map((a) => a.email);
    const totalPerAccount = new Map();
    accounts.forEach((a) => totalPerAccount.set(a.email, a.transactions.length));
    const activeCountPerAccount = new Map();
    accountEmails.forEach((email) => activeCountPerAccount.set(email, 0));

    // Per-account work queues; the pool scheduler pulls from these directly.
    const accountQueues = new Map();
    let totalItems = 0;
    accounts.forEach((acct) => {
      const items = acct.transactions.map((payload, idx) => ({
        itemId: `${jobId}-${acct.email}-${idx}`,
        index: idx,
        accountEmail: acct.email,
        payload: { ...payload, email: acct.email },
      }));
      accountQueues.set(acct.email, items);
      totalItems += items.length;
    });

    let queue = [];
    if (!usePool) {
      // Legacy interleaved scheduling — items ride on the user's currently-set proxy.
      const perAccountQueues = accounts.map((a) => accountQueues.get(a.email).slice());
      let globalIndex = 0;
      let anyLeft = true;
      while (anyLeft) {
        anyLeft = false;
        for (const accQueue of perAccountQueues) {
          if (accQueue.length > 0) {
            const item = accQueue.shift();
            queue.push({ ...item, index: globalIndex++ });
            anyLeft = true;
          }
        }
      }
    }

    // Two slots run in parallel when at least one proxy exists: slot 0 starts on the
    // server IP (proxyPool[0] = null) and slot 1 starts on the first proxy
    // (proxyPool[1]). Each slot's proxyId then rotates through the proxyPool cycle as
    // new accounts get assigned. If the pool has only the server IP (no proxies), fall
    // back to a single slot — one account at a time on the server IP.
    let slots = [];
    if (usePool) {
      slots.push({
        slotIndex: 0,
        proxyId: proxyPool[0] === undefined ? null : proxyPool[0],
        busy: false,
        currentAccount: null,
      });
      if (proxyPool.length >= 2) {
        slots.push({
          slotIndex: 1,
          proxyId: proxyPool[1] === undefined ? null : proxyPool[1],
          busy: false,
          currentAccount: null,
        });
      }
    }

    const job = {
      id: jobId,
      userId,
      mode: normalizedMode,
      status: 'running',
      concurrency: usePool ? perAccount * slots.length : perAccount * accountEmails.length,
      perAccountConcurrency: perAccount,
      activeCountPerAccount,
      totalPerAccount,
      pausedAccounts: new Set(),
      stoppedAccounts: new Set(),
      accounts: accountEmails,
      queue,
      accountQueues,
      usePool,
      proxyPool: usePool ? proxyPool.slice() : null,
      nextProxyIndex: 0,
      slots,
      accountSlot: new Map(),
      pendingAccounts: usePool ? accountEmails.slice() : [],
      activeCount: 0,
      paused: false,
      stopRequested: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: new Date(),
      endedAt: null,
      total: totalItems,
      counts: {
        unprocessed: totalItems,
        running: 0,
        success: 0,
        reviewing: 0,
        failed: 0,
        cancelled: 0,
      },
      processFn,
      onCompletedFn: onCompletedFn || null,
      lastResults: [],
      multiAccount: true,
    };

    this.jobs.set(jobId, job);

    this.emit(job, 'transactions:started', {
      message: 'Multi-account batch job started',
      accounts: accountEmails,
      perAccountConcurrency: perAccount,
      ...(usePool
        ? {
            proxyPool: proxyPool.map((proxyId, cycleIndex) => ({
              cycleIndex,
              proxyId: proxyId === undefined ? null : proxyId,
              ...getProxyMeta(proxyId === undefined ? null : proxyId),
            })),
          }
        : {}),
    });

    if (usePool) {
      // Announce starting position for accounts that won't get a slot immediately.
      accountEmails.forEach((email, position) => {
        if (position >= slots.length) {
          this.emit(job, 'transactions:account-waiting', {
            message: `Account ${email} is waiting for a free slot`,
            email,
            position,
          });
        }
      });
    }

    this.pump(jobId);

    return this.buildPublicJob(job);
  }

  getJob(jobId, userId) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return null;
    }

    return this.buildPublicJob(job);
  }

  pauseJob(jobId, userId) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return null;
    }

    if (job.status === 'completed' || job.status === 'stopped') {
      return this.buildPublicJob(job);
    }

    job.paused = true;
    job.status = 'paused';
    job.updatedAt = new Date();

    this.emit(job, 'transactions:paused', {
      message: 'Batch job paused',
    });

    return this.buildPublicJob(job);
  }

  resumeJob(jobId, userId) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return null;
    }

    if (job.status === 'completed' || job.status === 'stopped') {
      return this.buildPublicJob(job);
    }

    job.paused = false;
    job.status = 'running';
    job.updatedAt = new Date();

    this.emit(job, 'transactions:resumed', {
      message: 'Batch job resumed',
    });

    this.pump(jobId);

    return this.buildPublicJob(job);
  }

  stopJob(jobId, userId) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return null;
    }

    if (job.status === 'completed' || job.status === 'stopped') {
      return this.buildPublicJob(job);
    }

    job.stopRequested = true;
    job.paused = false;
    job.status = 'stopping';
    job.updatedAt = new Date();

    this.emit(job, 'transactions:stopping', {
      message: 'Stop requested for batch job',
    });

    this.pump(jobId);

    return this.buildPublicJob(job);
  }

  pauseAccount(jobId, userId, email) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId || !job.multiAccount) {
      return null;
    }
    if (!job.accounts.includes(email)) {
      return { error: 'ACCOUNT_NOT_IN_BATCH' };
    }
    if (job.status === 'completed' || job.status === 'stopped') {
      return this.buildPublicJob(job);
    }
    if (job.stoppedAccounts.has(email)) {
      return { error: 'ACCOUNT_ALREADY_STOPPED' };
    }

    job.pausedAccounts.add(email);
    job.updatedAt = new Date();

    this.emit(job, 'transactions:account-paused', {
      message: `Account ${email} paused`,
      email,
      pausedAccounts: Array.from(job.pausedAccounts),
    });

    return this.buildPublicJob(job);
  }

  resumeAccount(jobId, userId, email) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId || !job.multiAccount) {
      return null;
    }
    if (!job.accounts.includes(email)) {
      return { error: 'ACCOUNT_NOT_IN_BATCH' };
    }
    if (job.status === 'completed' || job.status === 'stopped') {
      return this.buildPublicJob(job);
    }
    if (job.stoppedAccounts.has(email)) {
      return { error: 'ACCOUNT_ALREADY_STOPPED' };
    }

    job.pausedAccounts.delete(email);
    job.updatedAt = new Date();

    this.emit(job, 'transactions:account-resumed', {
      message: `Account ${email} resumed`,
      email,
      pausedAccounts: Array.from(job.pausedAccounts),
    });

    this.pump(jobId);

    return this.buildPublicJob(job);
  }

  stopAccount(jobId, userId, email) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId || !job.multiAccount) {
      return null;
    }
    if (!job.accounts.includes(email)) {
      return { error: 'ACCOUNT_NOT_IN_BATCH' };
    }
    if (job.status === 'completed' || job.status === 'stopped') {
      return this.buildPublicJob(job);
    }
    if (job.stoppedAccounts.has(email)) {
      return this.buildPublicJob(job);
    }

    job.stoppedAccounts.add(email);
    job.pausedAccounts.delete(email);

    let cancelled = 0;
    if (job.usePool) {
      const accountQueue = job.accountQueues.get(email) || [];
      cancelled = accountQueue.length;
      job.accountQueues.set(email, []);
      job.pendingAccounts = job.pendingAccounts.filter((e) => e !== email);
      // Release the slot immediately so the next waiting account can take it.
      if (job.accountSlot.has(email)) {
        this.releaseSlot(job, email);
      }
    } else {
      const keep = [];
      for (const item of job.queue) {
        if (item.accountEmail === email) {
          cancelled += 1;
        } else {
          keep.push(item);
        }
      }
      job.queue = keep;
    }
    job.counts.unprocessed -= cancelled;
    job.counts.cancelled = (job.counts.cancelled || 0) + cancelled;
    job.updatedAt = new Date();

    this.emit(job, 'transactions:account-stopped', {
      message: `Account ${email} stopped — ${cancelled} queued item(s) cancelled`,
      email,
      cancelled,
      stoppedAccounts: Array.from(job.stoppedAccounts),
    });

    // If stopping this account means the whole job can finish, let pump finalize it.
    this.pump(jobId);

    return this.buildPublicJob(job);
  }

  logPumpState(job, label) {
    if (!job.multiAccount) return;
    const slotsView = job.usePool
      ? job.slots.map((s) => `slot${s.slotIndex}=${s.busy ? `${s.currentAccount}(proxy:${s.proxyId === null ? 'null' : s.proxyId})` : 'IDLE'}`).join(', ')
      : 'no-pool';
    const perAccount = job.accounts.map((email) => {
      const active = job.activeCountPerAccount.get(email) || 0;
      const queueLeft = job.usePool
        ? (job.accountQueues.get(email) || []).length
        : job.queue.filter((w) => w.accountEmail === email).length;
      const total = job.totalPerAccount.get(email) || 0;
      const done = total - queueLeft - active;
      return `${email}=${done}/${total}(active:${active}, queued:${queueLeft})`;
    }).join(' | ');
    console.log(`[pump:${label}][job ${job.id.slice(0, 8)}] slots=[${slotsView}] | accounts: ${perAccount} | pending=[${job.pendingAccounts.join(',')}]`);
  }

  async pump(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    if (job.stopRequested) {
      console.log(`[pump:stop-requested][job ${job.id.slice(0, 8)}] activeCount=${job.activeCount}`);
      if (job.activeCount === 0) {
        this.finalizeStopped(job);
      }
      return;
    }

    if (job.paused) {
      console.log(`[pump:paused][job ${job.id.slice(0, 8)}] paused, skipping`);
      return;
    }

    if (job.multiAccount && job.usePool) {
      this.logPumpState(job, 'enter');
      this.assignPendingSlotsToAccounts(job);

      for (const slot of job.slots) {
        if (!slot.busy || !slot.currentAccount) continue;
        const email = slot.currentAccount;
        if (job.pausedAccounts.has(email) || job.stoppedAccounts.has(email)) continue;

        const accountQueue = job.accountQueues.get(email) || [];
        while (
          accountQueue.length > 0 &&
          (job.activeCountPerAccount.get(email) || 0) < job.perAccountConcurrency &&
          !job.paused &&
          !job.stopRequested
        ) {
          const workItem = accountQueue.shift();
          job.activeCountPerAccount.set(email, (job.activeCountPerAccount.get(email) || 0) + 1);
          job.activeCount += 1;
          job.counts.unprocessed -= 1;
          job.counts.running += 1;
          job.updatedAt = new Date();
          this.processItem(job, { ...workItem, slotIndex: slot.slotIndex, proxyId: slot.proxyId });
        }
      }
    } else if (job.multiAccount) {
      const remaining = [];
      for (const workItem of job.queue) {
        if (job.paused || job.stopRequested) {
          remaining.push(workItem);
          continue;
        }
        if (job.pausedAccounts.has(workItem.accountEmail) || job.stoppedAccounts.has(workItem.accountEmail)) {
          remaining.push(workItem);
          continue;
        }
        const currentActive = job.activeCountPerAccount.get(workItem.accountEmail) || 0;
        if (currentActive < job.perAccountConcurrency) {
          job.activeCountPerAccount.set(workItem.accountEmail, currentActive + 1);
          job.activeCount += 1;
          job.counts.unprocessed -= 1;
          job.counts.running += 1;
          job.updatedAt = new Date();
          this.processItem(job, workItem);
        } else {
          remaining.push(workItem);
        }
      }
      job.queue = remaining;
    } else {
      while (job.activeCount < job.concurrency && job.queue.length > 0 && !job.paused && !job.stopRequested) {
        const workItem = job.queue.shift();
        job.activeCount += 1;
        job.counts.unprocessed -= 1;
        job.counts.running += 1;
        job.updatedAt = new Date();

        this.processItem(job, workItem);
      }
    }

    const queueDrained = job.usePool
      ? Array.from(job.accountQueues.values()).every((q) => q.length === 0)
      : job.queue.length === 0;

    if (job.activeCount === 0 && queueDrained && !job.stopRequested) {
      this.finalizeCompleted(job);
    }
  }

  assignPendingSlotsToAccounts(job) {
    if (!job.usePool) return;
    // FIFO: walk pendingAccounts in order, give each the first free slot.
    // Stopped accounts drop out; paused accounts stay pending (no slot).
    const stillPending = [];
    for (const email of job.pendingAccounts) {
      if (job.stoppedAccounts.has(email)) {
        continue;
      }
      if (job.pausedAccounts.has(email)) {
        stillPending.push(email);
        continue;
      }
      const accountQueue = job.accountQueues.get(email) || [];
      if (accountQueue.length === 0) {
        continue;
      }
      const freeSlot = job.slots.find((s) => !s.busy);
      if (!freeSlot) {
        stillPending.push(email);
        continue;
      }

      // Rotate to the next IP in the cycle for this account. Cycle wraps when accounts
      // outnumber IPs (e.g. 5 accounts, cycle [null, 1, 2] → null, 1, 2, null, 1).
      if (job.proxyPool && job.proxyPool.length > 0) {
        const cycleEntry = job.proxyPool[job.nextProxyIndex % job.proxyPool.length];
        freeSlot.proxyId = cycleEntry === undefined ? null : cycleEntry;
        job.nextProxyIndex += 1;
      }

      freeSlot.busy = true;
      freeSlot.currentAccount = email;
      job.accountSlot.set(email, freeSlot.slotIndex);
      console.log(`[slot-assign][job ${job.id.slice(0, 8)}][acct ${email}] slot=${freeSlot.slotIndex} proxyId=${freeSlot.proxyId === null ? 'null(server-IP)' : freeSlot.proxyId} queueSize=${(job.accountQueues.get(email) || []).length}`);
      this.emit(job, 'transactions:account-slot-assigned', {
        message: `Account ${email} assigned to slot ${freeSlot.slotIndex}`,
        email,
        slotIndex: freeSlot.slotIndex,
        proxyId: freeSlot.proxyId,
        ...getProxyMeta(freeSlot.proxyId),
        waitingForSlot: false,
      });
    }
    job.pendingAccounts = stillPending;
  }

  releaseSlot(job, email) {
    if (!job.usePool) return;
    const slotIndex = job.accountSlot.get(email);
    if (slotIndex === undefined) return;
    const slot = job.slots[slotIndex];
    if (!slot) return;
    slot.busy = false;
    slot.currentAccount = null;
    job.accountSlot.delete(email);
    console.log(`[slot-release][job ${job.id.slice(0, 8)}][acct ${email}] slot=${slotIndex} proxyId=${slot.proxyId === null ? 'null(server-IP)' : slot.proxyId} — slot now free for next account`);
    this.emit(job, 'transactions:account-slot-released', {
      message: `Account ${email} released slot ${slotIndex}`,
      email,
      slotIndex,
      proxyId: slot.proxyId,
    });
  }

  async processItem(job, workItem) {
    const startTime = Date.now();
    const acctTag = workItem.accountEmail ? `[acct ${workItem.accountEmail}]` : '';
    const tag = `[manager][job ${job.id.slice(0, 8)}]${acctTag}[item ${workItem.index}]`;
    const slotProxyAssigned = job.usePool && workItem.slotIndex !== undefined;
    const slotInfo = slotProxyAssigned
      ? { slotIndex: workItem.slotIndex, proxyId: workItem.proxyId }
      : {};

    const queueLeft = job.usePool
      ? Array.from(job.accountQueues.values()).reduce((n, q) => n + q.length, 0)
      : job.queue.length;
    console.log(`${tag} Processing started — mode: ${job.mode}, activeCount: ${job.activeCount}, queueLeft: ${queueLeft}${slotProxyAssigned ? `, slot: ${workItem.slotIndex}, proxyId: ${workItem.proxyId === null ? 'null(server-IP)' : workItem.proxyId}` : ''}`);

    try {
      const output = await job.processFn({
        jobId: job.id,
        userId: job.userId,
        itemIndex: workItem.index,
        payload: workItem.payload,
        proxyId: slotProxyAssigned ? workItem.proxyId : undefined,
        slotProxyAssigned,
      });

      const itemStatus = output?.transactionStatus === 'reviewing' ? 'reviewing' : 'success';

      const result = {
        itemId: workItem.itemId,
        itemIndex: workItem.index,
        ...(job.multiAccount && workItem.accountEmail ? { accountEmail: workItem.accountEmail } : {}),
        ...slotInfo,
        status: itemStatus,
        processingMs: Date.now() - startTime,
        output,
      };

      if (itemStatus === 'reviewing') {
        console.log(`${tag} REVIEWING (no pins yet) — ${result.processingMs}ms`);
        job.counts.reviewing += 1;
      } else {
        console.log(`${tag} SUCCESS — ${result.processingMs}ms`);
        job.counts.success += 1;
      }
      console.log(`[summary] acct=${workItem.accountEmail || 'n/a'} item=${workItem.index} status=${itemStatus} ms=${result.processingMs}${slotProxyAssigned ? ` slot=${workItem.slotIndex} proxyId=${workItem.proxyId === null ? 'null' : workItem.proxyId}` : ''}`);
      this.pushResult(job, result);
    } catch (err) {
      const result = {
        itemId: workItem.itemId,
        itemIndex: workItem.index,
        ...(job.multiAccount && workItem.accountEmail ? { accountEmail: workItem.accountEmail } : {}),
        ...slotInfo,
        status: 'failed',
        processingMs: Date.now() - startTime,
        error: err && err.message ? err.message : 'Unknown processing error',
      };

      console.error(`${tag} FAILED — ${result.processingMs}ms — error: ${result.error}`);
      console.log(`[summary] acct=${workItem.accountEmail || 'n/a'} item=${workItem.index} status=failed ms=${result.processingMs}${slotProxyAssigned ? ` slot=${workItem.slotIndex} proxyId=${workItem.proxyId === null ? 'null' : workItem.proxyId}` : ''} error="${result.error}"`);
      this.pushResult(job, result);
      job.counts.failed += 1;
    } finally {
      job.activeCount -= 1;
      job.counts.running -= 1;
      if (job.multiAccount && workItem.accountEmail) {
        const prev = job.activeCountPerAccount.get(workItem.accountEmail) || 0;
        job.activeCountPerAccount.set(workItem.accountEmail, Math.max(0, prev - 1));
      }
      job.updatedAt = new Date();

      console.log(`${tag} counts after:`, { ...job.counts });

      // Per-account progress: easy to grep `[progress] acct=foo@bar` to see one account's completion rate.
      if (workItem.accountEmail) {
        const email = workItem.accountEmail;
        const total = job.totalPerAccount ? (job.totalPerAccount.get(email) || 0) : 0;
        const remainingActive = job.activeCountPerAccount.get(email) || 0;
        const remainingQueue = job.usePool
          ? (job.accountQueues.get(email) || []).length
          : job.queue.filter((w) => w.accountEmail === email).length;
        const done = total - remainingQueue - remainingActive;
        console.log(`[progress] acct=${email} ${done}/${total} done (active=${remainingActive}, queued=${remainingQueue})`);
      }

      // Release slot when this account has drained (no in-flight, no queued).
      if (job.usePool && workItem.accountEmail) {
        const email = workItem.accountEmail;
        const remainingActive = job.activeCountPerAccount.get(email) || 0;
        const remainingQueue = (job.accountQueues.get(email) || []).length;
        if (remainingActive === 0 && remainingQueue === 0 && job.accountSlot.has(email)) {
          console.log(`[acct ${email}] account fully drained — releasing slot ${job.accountSlot.get(email)}`);
          this.releaseSlot(job, email);
        }
      }

      this.emit(job, 'transactions:progress', {
        message: 'Batch progress update',
        lastResult: job.lastResults[job.lastResults.length - 1] || null,
      });

      this.pump(job.id);
    }
  }

  pushResult(job, result) {
    job.lastResults.push(result);
  }

  buildCompletionPayload(job) {
    const base = {
      jobId: job.id,
      userId: job.userId,
      mode: job.mode,
      total: job.total,
      counts: { ...job.counts },
      completedAt: job.endedAt,
      transactions: [...job.lastResults],
    };
    if (job.multiAccount) {
      base.multiAccount = true;
      base.accounts = [...job.accounts];
      base.perAccountConcurrency = job.perAccountConcurrency;
      base.pausedAccounts = Array.from(job.pausedAccounts || []);
      base.stoppedAccounts = Array.from(job.stoppedAccounts || []);
      if (job.usePool) {
        base.proxyPool = (job.proxyPool || []).slice();
      }
    }
    return base;
  }

  finalizeCompleted(job) {
    job.status = 'completed';
    job.endedAt = new Date();
    job.updatedAt = new Date();

    this.emit(job, 'transactions:completed', {
      message: 'Batch job completed',
      transactions: [...job.lastResults],
    });

    if (typeof job.onCompletedFn === 'function') {
      job.onCompletedFn(this.buildCompletionPayload(job)).catch((err) => {
        console.error('[TransactionsManager] Failed to save completed batch:', err.message);
      });
    }
  }

  finalizeStopped(job) {
    if (job.queue.length > 0) {
      job.queue.length = 0;
    }
    if (job.accountQueues) {
      for (const q of job.accountQueues.values()) {
        q.length = 0;
      }
    }
    if (job.usePool && job.slots) {
      for (const slot of job.slots) {
        if (slot.busy && slot.currentAccount) {
          this.releaseSlot(job, slot.currentAccount);
        }
      }
    }

    job.status = 'stopped';
    job.endedAt = new Date();
    job.updatedAt = new Date();

    this.emit(job, 'transactions:stopped', {
      message: 'Batch job stopped',
      transactions: [...job.lastResults],
    });

    if (typeof job.onCompletedFn === 'function') {
      job.onCompletedFn(this.buildCompletionPayload(job)).catch((err) => {
        console.error('[TransactionsManager] Failed to save stopped batch:', err.message);
      });
    }
  }

  emit(job, eventName, extra = {}) {
    const payload = {
      event: eventName,
      jobId: job.id,
      userId: job.userId,
      mode: job.mode,
      status: job.status,
      concurrency: job.concurrency,
      total: job.total,
      counts: { ...job.counts },
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      endedAt: job.endedAt,
      ...extra,
    };

    emitTransactionEvent(job.userId, job.id, eventName, payload);
  }

  buildPublicJob(job) {
    return {
      jobId: job.id,
      userId: job.userId,
      mode: job.mode,
      status: job.status,
      concurrency: job.concurrency,
      total: job.total,
      counts: { ...job.counts },
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      endedAt: job.endedAt,
      lastResults: [...job.lastResults],
      ...(job.multiAccount
        ? {
            multiAccount: true,
            accounts: job.accounts,
            perAccountConcurrency: job.perAccountConcurrency,
            pausedAccounts: Array.from(job.pausedAccounts || []),
            stoppedAccounts: Array.from(job.stoppedAccounts || []),
            ...(job.usePool
              ? {
                  proxyPool: (job.proxyPool || []).slice(),
                  slots: (job.slots || []).map((s) => ({
                    slotIndex: s.slotIndex,
                    proxyId: s.proxyId,
                    busy: s.busy,
                    currentAccount: s.currentAccount,
                    ...getProxyMeta(s.proxyId),
                  })),
                  pendingAccounts: (job.pendingAccounts || []).slice(),
                }
              : {}),
          }
        : {}),
    };
  }
}

module.exports = {
  TransactionsManager,
  MAX_CONCURRENCY,
  ALLOWED_MODES,
};
