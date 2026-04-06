const crypto = require('crypto');
const { emitTransactionEvent } = require('./transactions.events');

const MAX_CONCURRENCY = 10;
const ALLOWED_MODES = new Set(['fake', 'mongodb']);

class TransactionsManager {
  constructor() {
    this.jobs = new Map();
  }

  createJob({ userId, transactions, concurrency, mode, processFn }) {
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
        pending: queue.length,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
      processFn,
      lastResults: [],
    };

    this.jobs.set(jobId, job);

    this.emit(job, 'transactions:started', {
      message: 'Batch job started',
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

    while (job.activeCount < job.concurrency && job.queue.length > 0 && !job.paused && !job.stopRequested) {
      const workItem = job.queue.shift();
      job.activeCount += 1;
      job.counts.pending -= 1;
      job.counts.running += 1;
      job.updatedAt = new Date();

      this.processItem(job, workItem);
    }

    if (job.activeCount === 0 && job.queue.length === 0 && !job.stopRequested) {
      this.finalizeCompleted(job);
    }
  }

  async processItem(job, workItem) {
    const startTime = Date.now();

    try {
      const output = await job.processFn({
        jobId: job.id,
        userId: job.userId,
        itemIndex: workItem.index,
        payload: workItem.payload,
      });

      const result = {
        itemId: workItem.itemId,
        itemIndex: workItem.index,
        status: 'success',
        processingMs: Date.now() - startTime,
        output,
      };

      this.pushResult(job, result);
      job.counts.completed += 1;
    } catch (err) {
      const result = {
        itemId: workItem.itemId,
        itemIndex: workItem.index,
        status: 'failed',
        processingMs: Date.now() - startTime,
        error: err && err.message ? err.message : 'Unknown processing error',
      };

      this.pushResult(job, result);
      job.counts.failed += 1;
    } finally {
      job.activeCount -= 1;
      job.counts.running -= 1;
      job.updatedAt = new Date();

      this.emit(job, 'transactions:progress', {
        message: 'Batch progress update',
        lastResult: job.lastResults[job.lastResults.length - 1] || null,
      });

      this.pump(job.id);
    }
  }

  pushResult(job, result) {
    job.lastResults.push(result);

    const MAX_BUFFERED_RESULTS = 100;
    if (job.lastResults.length > MAX_BUFFERED_RESULTS) {
      job.lastResults.shift();
    }
  }

  finalizeCompleted(job) {
    job.status = 'completed';
    job.endedAt = new Date();
    job.updatedAt = new Date();

    this.emit(job, 'transactions:completed', {
      message: 'Batch job completed',
    });
  }

  finalizeStopped(job) {
    const cancelled = job.queue.length;
    if (cancelled > 0) {
      job.counts.cancelled += cancelled;
      job.queue.length = 0;
    }

    job.status = 'stopped';
    job.endedAt = new Date();
    job.updatedAt = new Date();

    this.emit(job, 'transactions:stopped', {
      message: 'Batch job stopped',
    });
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
    };
  }
}

module.exports = {
  TransactionsManager,
  MAX_CONCURRENCY,
  ALLOWED_MODES,
};
