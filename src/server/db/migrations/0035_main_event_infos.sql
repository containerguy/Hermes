-- Infos pro Event (Anfahrt, WLAN, Ablauf …) als Markdown, zusätzlich zu den allgemeinen Infos.
ALTER TABLE main_events ADD COLUMN infos_markdown TEXT;
