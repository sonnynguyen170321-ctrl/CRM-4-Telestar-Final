export class RetryableResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableResearchError';
  }
}
