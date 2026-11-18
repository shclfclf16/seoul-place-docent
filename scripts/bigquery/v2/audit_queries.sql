-- Read-only queries. Execute ONLY after uploading six staging tables and creating candidate views.
SELECT source_file_type, record_type, COUNT(*) AS record_count
FROM `seoul-place-docent-514906.seoul_history.v2_records_15dcc4c5894501266afb2062e7ba8eb4dd9f12970b7f2309e8c14410b80bae90`
GROUP BY 1,2 ORDER BY record_count DESC;

SELECT audit_state, relation_type, COUNT(*) AS link_count
FROM `seoul-place-docent-514906.seoul_history.v2_relation_audit_15dcc4c5894501266afb2062e7ba8eb4dd9f12970b7f2309e8c14410b80bae90`
GROUP BY 1,2 ORDER BY link_count DESC;

-- These are unreviewed research records, not published evidence.
SELECT record_id, record_title, review_status, source_url, media_url
FROM `seoul-place-docent-514906.seoul_history.v2_records_15dcc4c5894501266afb2062e7ba8eb4dd9f12970b7f2309e8c14410b80bae90`
WHERE record_type = 'PHOTO' LIMIT 20;

-- Inspect only, NEVER assume place coordinates / address or any DIRECT match exists.
SELECT district, COUNT(*) AS places,
  COUNTIF(NULLIF(road_address, '') IS NOT NULL) AS with_road_address,
  COUNTIF(latitude_value IS NOT NULL AND longitude_value IS NOT NULL) AS with_coordinates
FROM `seoul-place-docent-514906.seoul_history.v2_places_15dcc4c5894501266afb2062e7ba8eb4dd9f12970b7f2309e8c14410b80bae90`
GROUP BY 1 ORDER BY places DESC LIMIT 25;
