-- Pizza ist ab Matchdesk 0.17 ein Modul. Das Recht gehört jetzt dem Modul, Rollenzuordnungen und
-- Vergaben bleiben erhalten. Die Tabellen pizza_* bleiben stehen und werden vom Modul übernommen.
UPDATE permissions SET module_id = 'pizza', scopable = 1 WHERE key = 'pizza.manage' AND module_id IS NULL;
