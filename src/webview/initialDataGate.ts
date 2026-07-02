export class InitialDataGate {
  private sent = false;

  reset(): void {
    this.sent = false;
  }

  shouldSend(): boolean {
    if (this.sent) return false;
    this.sent = true;
    return true;
  }
}
