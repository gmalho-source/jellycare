import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Os ficheiros deste pacote partilham a mesma base de dados e, em alguns
    // casos, um browser. Corridos em paralelo disputam ligações e memória, o
    // que produz falhas que não reproduzem e não significam nada.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
