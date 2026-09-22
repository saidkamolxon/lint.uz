-- One row per person per format. The voter column is a one-way hash of the
-- visitor's IP, the format and a server-side secret: it dedups, but nobody
-- holding this table can recover an address from it.
CREATE TABLE IF NOT EXISTS interest (
  format TEXT NOT NULL,
  voter  TEXT NOT NULL,
  at     INTEGER NOT NULL,
  PRIMARY KEY (format, voter)
);

-- the page asks "how many for this format?" on every render
CREATE INDEX IF NOT EXISTS interest_by_format ON interest (format);
