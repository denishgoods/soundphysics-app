// sp/wav.h — minimal WAV read/write (16-bit PCM + 32-bit float read).
#pragma once
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <cstdint>

namespace sp {

inline bool writeWav16(const std::string& path, const std::vector<float>& L,
                       const std::vector<float>& R, int sampleRate) {
  FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) return false;
  uint32_t n = (uint32_t)L.size();
  uint32_t dataBytes = n * 2 * 2;
  uint32_t riff = 36 + dataBytes;
  uint16_t ch = 2, bits = 16, block = ch * bits / 8;
  uint32_t byteRate = sampleRate * block;
  uint32_t fmtLen = 16; uint16_t fmt = 1;
  std::fwrite("RIFF", 1, 4, f); std::fwrite(&riff, 4, 1, f);
  std::fwrite("WAVE", 1, 4, f); std::fwrite("fmt ", 1, 4, f);
  std::fwrite(&fmtLen, 4, 1, f); std::fwrite(&fmt, 2, 1, f);
  std::fwrite(&ch, 2, 1, f);
  std::fwrite(&sampleRate, 4, 1, f);
  std::fwrite(&byteRate, 4, 1, f); std::fwrite(&block, 2, 1, f);
  std::fwrite(&bits, 2, 1, f);
  std::fwrite("data", 1, 4, f); std::fwrite(&dataBytes, 4, 1, f);
  for (uint32_t i = 0; i < n; i++) {
    float sl = L[i] < -1 ? -1 : (L[i] > 1 ? 1 : L[i]);
    float sr = R[i] < -1 ? -1 : (R[i] > 1 ? 1 : R[i]);
    int16_t l = (int16_t)(sl * 32767), r = (int16_t)(sr * 32767);
    std::fwrite(&l, 2, 1, f); std::fwrite(&r, 2, 1, f);
  }
  std::fclose(f);
  return true;
}

// reads 16-bit PCM or 32-bit float wav, mixes to mono
inline bool readWavMono(const std::string& path, std::vector<float>& out, int& sampleRate) {
  FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) return false;
  char id[5] = {0};
  uint32_t sz;
  std::fread(id, 1, 4, f); std::fread(&sz, 4, 1, f); std::fread(id, 1, 4, f);
  uint16_t fmt = 1, ch = 1, bits = 16;
  uint32_t rate = 48000;
  bool haveData = false;
  while (!haveData && std::fread(id, 1, 4, f) == 4) {
    uint32_t len; std::fread(&len, 4, 1, f);
    if (!std::strncmp(id, "fmt ", 4)) {
      std::fread(&fmt, 2, 1, f); std::fread(&ch, 2, 1, f);
      std::fread(&rate, 4, 1, f);
      std::fseek(f, 6, SEEK_CUR);
      std::fread(&bits, 2, 1, f);
      std::fseek(f, (long)len - 16, SEEK_CUR);
    } else if (!std::strncmp(id, "data", 4)) {
      uint32_t frames = len / (ch * bits / 8);
      out.resize(frames);
      for (uint32_t i = 0; i < frames; i++) {
        float acc = 0;
        for (int c = 0; c < ch; c++) {
          if (bits == 16) { int16_t v; std::fread(&v, 2, 1, f); acc += v / 32768.0f; }
          else if (bits == 32 && fmt == 3) { float v; std::fread(&v, 4, 1, f); acc += v; }
          else { std::fseek(f, bits / 8, SEEK_CUR); }
        }
        out[i] = acc / ch;
      }
      haveData = true;
    } else {
      std::fseek(f, (long)len, SEEK_CUR);
    }
  }
  std::fclose(f);
  sampleRate = (int)rate;
  return haveData;
}

} // namespace sp
