declare global {
  interface Window {
    remotepair: {
      complete: () => Promise<void>
    }
  }
}

export {}
