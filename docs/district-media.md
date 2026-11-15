# 구별 사진·기사 조사자료

`data/district-media/manifest.json` records the imported CSV list and its SHA-256 fingerprints. The original UTF-8 CSV bytes are stored losslessly as gzip files under `public/research/district-media-20261115/`; the archive page fetches and decompresses only the file selected by district and media type.

To refresh from the supplied folder layout, run:

```powershell
node scripts/import-district-media.mjs "C:\Users\shclf\OneDrive\바탕 화면\자료조사"
```

The importer checks the expected 50 CSV files, reads each CSV header and record count, preserves the source file bytes, and classifies files by both filename and columns. The supplied batch has 25 article files and 25 photo/map files. `성북구_역사사진.csv` is encoded in EUC-KR; the viewer decodes it for display while the downloadable archive retains the original bytes. The importer does not deduplicate or delete source rows.

The archive keeps each row's supplied verification and rights labels as source data. It does not embed image files, grant permission to reuse them, independently verify claims or article dates, or add these rows to automatic address narratives.
