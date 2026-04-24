const crypto = require('crypto');
const { emitTransactionEvent } = require('./transactions.events');

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

  createMultiJob({ userId, accounts, perAccountConcurrency, mode, processFn, onCompletedFn }) {
    const perAccount = Math.max(1, Math.min(MAX_CONCURRENCY, Number(perAccountConcurrency) || 3));
    const normalizedMode = ALLOWED_MODES.has(mode) ? mode : 'fake';

    const jobId = crypto.randomUUID();

    // Interleave items across accounts so all accounts start work immediately
    const perAccountQueues = accounts.map((acct) =>
      acct.transactions.map((payload, idx) => ({ email: acct.email, payload, accountIdx: idx }))
    );

    const queue = [];
    let globalIndex = 0;
    let anyLeft = true;
    while (anyLeft) {
      anyLeft = false;
      for (const accQueue of perAccountQueues) {
        if (accQueue.length > 0) {
          const item = accQueue.shift();
          queue.push({
            itemId: `${jobId}-${item.email}-${item.accountIdx}`,
            index: globalIndex++,
            accountEmail: item.email,
            payload: { ...item.payload, email: item.email },
          });
          anyLeft = true;
        }
      }
    }

    const activeCountPerAccount = new Map();
    const totalPerAccount = new Map();
    const accountEmails = accounts.map((a) => a.email);
    accountEmails.forEach((email) => activeCountPerAccount.set(email, 0));
    accounts.forEach((a) => totalPerAccount.set(a.email, a.transactions.length));

    const job = {
      id: jobId,
      userId,
      mode: normalizedMode,
      status: 'running',
      concurrency: perAccount * accountEmails.length,
      perAccountConcurrency: perAccount,
      activeCountPerAccount,
      totalPerAccount,
      pausedAccounts: new Set(),
      stoppedAccounts: new Set(),
      accounts: accountEmails,
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
    });

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

    // Drop queued items for this account; in-flight items keep running.
    const keep = [];
    let cancelled = 0;
    for (const item of job.queue) {
      if (item.accountEmail === email) {
        cancelled += 1;
      } else {
        keep.push(item);
      }
    }
    job.queue = keep;
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

  async pump(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    if (job.stopRequested) {
      if (job.activeCount === 0) {
        this.finalizeStopped(job);
      }
      return;
    }

    if (job.paused) {
      return;
    }

    if (job.multiAccount) {
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

    if (job.activeCount === 0 && job.queue.length === 0 && !job.stopRequested) {
      this.finalizeCompleted(job);
    }
  }

  async processItem(job, workItem) {
    const startTime = Date.now();
    const tag = `[manager][job ${job.id.slice(0, 8)}][item ${workItem.index}]`;

    console.log(`${tag} Processing started — mode: ${job.mode}, activeCount: ${job.activeCount}, queueLeft: ${job.queue.length}`);

    try {
      const output = await job.processFn({
        jobId: job.id,
        userId: job.userId,
        itemIndex: workItem.index,
        payload: workItem.payload,
      });

      const itemStatus = output?.transactionStatus === 'reviewing' ? 'reviewing' : 'success';

      const result = {
        itemId: workItem.itemId,
        itemIndex: workItem.index,
        ...(job.multiAccount && workItem.accountEmail ? { accountEmail: workItem.accountEmail } : {}),
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
      this.pushResult(job, result);
    } catch (err) {
      const result = {
        itemId: workItem.itemId,
        itemIndex: workItem.index,
        ...(job.multiAccount && workItem.accountEmail ? { accountEmail: workItem.accountEmail } : {}),
        status: 'failed',
        processingMs: Date.now() - startTime,
        error: err && err.message ? err.message : 'Unknown processing error',
      };

      console.error(`${tag} FAILED — ${result.processingMs}ms — error: ${result.error}`);
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
