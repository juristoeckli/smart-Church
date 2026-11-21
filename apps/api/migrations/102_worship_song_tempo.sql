ALTER TABLE worship_songs
  ADD COLUMN IF NOT EXISTS bpm INTEGER CHECK (bpm BETWEEN 1 AND 400),
  ADD COLUMN IF NOT EXISTS time_signature TEXT CHECK (
    time_signature ~ '^([1-9]|[1-5][0-9]|6[0-4])/(1|2|4|8|16|32|64)$'
  );
