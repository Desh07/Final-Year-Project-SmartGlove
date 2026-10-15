// ─── Sentence Builder Service ───
// Accumulates recognized gestures into a sentence
// with hold-to-confirm logic and duplicate suppression

export type SentenceState = {
  words: string[];
  currentHoldSign: string;
  holdStartTime: number;
  holdProgress: number; // 0.0 to 1.0
  isHolding: boolean;
  lastAddedSign: string;
};

// ─── Sign → Language Translation Map ───
const TRANSLATIONS: Record<string, Record<string, string>> = {
  'HELLO':    { en: 'Hello',    si: 'ආයුබෝවන්',      ta: 'வணக்கம்' },
  'CALL ME':  { en: 'Call me',  si: 'මට කතා කරන්න', ta: 'என்னை அழைக்கவும்' },
  'VICTORY':  { en: 'Victory',  si: 'ජයග්‍රහණය',    ta: 'வெற்றி' },
  'MILK':     { en: 'Milk',     si: 'කිරි',          ta: 'பால்' },
  'OK':       { en: 'OK',       si: 'හරි',           ta: 'சரி' },
  'QUESTION': { en: 'Question', si: 'ප්‍රශ්නය',      ta: 'கேள்வி' },
  'YOU':      { en: 'You',      si: 'ඔබ',            ta: 'நீங்கள்' },
  'GOOD':     { en: 'Good',     si: 'හොඳයි',         ta: 'நன்று' },
  'BAD':      { en: 'Bad',      si: 'නරකයි',        ta: 'மோசம்' },
  'LOVE':     { en: 'Love',     si: 'ආදරය',         ta: 'அன்பு' },
  'CALL':     { en: 'Call',     si: 'ඇමතුමක්',       ta: 'அழை' },
};

export function translateSign(sign: string, lang: 'en' | 'si' | 'ta'): string {
  const upper = (sign || '').toUpperCase();
  return TRANSLATIONS[upper]?.[lang] ?? TRANSLATIONS[sign]?.[lang] ?? sign;
}

export class SentenceBuilder {
  private words: string[] = [];
  private currentHoldSign: string = '';
  private holdStartTime: number = 0;
  private lastAddedSign: string = '';

  // Config
  private holdDurationMs: number;
  private minConfidence: number;

  constructor(holdDurationMs = 800, minConfidence = 0.80) {
    this.holdDurationMs = holdDurationMs;
    this.minConfidence = minConfidence;
  }

  /**
   * Process a new prediction result from the inference engine.
   * Call this every frame (25Hz).
   *
   * Returns true if a new word was added to the sentence.
   */
  update(
    sign: string,
    confidence: number,
    isStill: boolean
  ): boolean {
    const now = Date.now();

    // Only consider high-confidence, still predictions
    if (confidence < this.minConfidence || !isStill) {
      this.currentHoldSign = '';
      this.holdStartTime = 0;
      return false;
    }

    // Same sign as we're currently holding?
    if (sign === this.currentHoldSign) {
      const elapsed = now - this.holdStartTime;
      if (elapsed >= this.holdDurationMs) {
        // Confirmed! Add the word
        const added = this.addWord(sign);
        this.currentHoldSign = '';
        this.holdStartTime = 0;
        return added;
      }
      // Still holding...
      return false;
    }

    // Different sign — start new hold
    this.currentHoldSign = sign;
    this.holdStartTime = now;
    return false;
  }

  /**
   * Add a word to the sentence.
   * Returns false if it's a duplicate of the last word.
   */
  addWord(word: string): boolean {
    // Duplicate suppression
    if (this.words.length > 0 && this.words[this.words.length - 1] === word) {
      return false;
    }
    this.words.push(word);
    this.lastAddedSign = word;
    return true;
  }

  /** Remove the last word */
  undo(): void {
    this.words.pop();
    this.lastAddedSign = this.words[this.words.length - 1] || '';
  }

  /** Clear the entire sentence */
  clear(): void {
    this.words = [];
    this.currentHoldSign = '';
    this.holdStartTime = 0;
    this.lastAddedSign = '';
  }

  /** Add a space/separator marker */
  addSpace(): void {
    this.words.push('…');
  }

  /** Get the current sentence state */
  getState(): SentenceState {
    const now = Date.now();
    const elapsed = this.currentHoldSign ? now - this.holdStartTime : 0;
    const progress = this.currentHoldSign
      ? Math.min(1, elapsed / this.holdDurationMs)
      : 0;

    return {
      words: [...this.words],
      currentHoldSign: this.currentHoldSign,
      holdStartTime: this.holdStartTime,
      holdProgress: progress,
      isHolding: this.currentHoldSign !== '' && progress < 1,
      lastAddedSign: this.lastAddedSign,
    };
  }

  /** Get the sentence as a translatable string */
  getSentenceText(lang: 'en' | 'si' | 'ta' = 'en'): string {
    return this.words
      .filter(w => w !== '…')
      .map(w => translateSign(w, lang))
      .join(' ');
  }

  /** Get the word count */
  getWordCount(): number {
    return this.words.filter(w => w !== '…').length;
  }
}
