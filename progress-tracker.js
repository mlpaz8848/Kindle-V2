// utils/progress-tracker.js
class ProgressTracker {
  constructor() {
    this.tasks = new Map();
  }

  startTask(taskId, totalSteps) {
    this.tasks.set(taskId, {
      startTime: Date.now(),
      totalSteps,
      currentStep: 0,
      status: 'started',
      errors: []
    });
  }

  updateProgress(taskId, currentStep, status = 'processing') {
    const task = this.tasks.get(taskId);
    if (task) {
      task.currentStep = currentStep;
      task.status = status;
      task.lastUpdate = Date.now();

      // Calculate percentage
      const percentage = Math.round((currentStep / task.totalSteps) * 100);
      return percentage;
    }
    return 0;
  }

  addError(taskId, error) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.errors.push({
        timestamp: Date.now(),
        error: error.message,
        stack: error.stack
      });
      task.status = 'error';
    }
  }

  completeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.endTime = Date.now();
      task.duration = task.endTime - task.startTime;
    }
  }

  getTaskStatus(taskId) {
    return this.tasks.get(taskId);
  }
}

module.exports = new ProgressTracker();
