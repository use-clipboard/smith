# HMRC blank Self Assessment form templates (2025–26)

Official blank HMRC SA forms, downloaded from gov.uk publications (Crown copyright,
published for taxpayers to print and complete — reproduced here to stamp a client's
figures onto for their filing copy).

Source: `https://www.gov.uk/government/publications/self-assessment-*` → the
`assets.publishing.service.gov.uk/media/.../SA*-2026.pdf` asset on each page.

These are **flat** print PDFs — only SA100 carries any interactive AcroForm fields
(UTR, NINO, Ref, Name); every numbered box and tick box is drawn, not a form field.
So values are stamped at page coordinates (pdf-lib) rather than filled by field name.
Box coordinates are extracted offline with `pdf2json` (page grid → PDF points × 16).

| File | Form | Pages | Fillable fields |
|---|---|---|---|
| SA100-2026.pdf | Tax Return (main) | 10 | 4 (UTR/NINO/Ref/Name) |
| SA101-2026.pdf | Additional information | 4 | 0 |
| SA102-2026.pdf | Employment | 2 | 0 |
| SA103S/F-2026.pdf | Self-employment (short/full) | 2 / 6 | 0 |
| SA104S/F-2026.pdf | Partnership (short/full) | 2 / 5 | 0 |
| SA105-2026.pdf | UK property | 2 | 0 |
| SA106-2026.pdf | Foreign | 8 | 0 |
| SA107-2026.pdf | Trusts etc. | 2 | 0 |
| SA108-2026.pdf | Capital gains summary | 4 | 0 |
| SA109-2026.pdf | Residence, remittance basis etc. | 4 | 0 |
| SA103L-2026.pdf | Lloyd's Underwriters | 4 | 0 |

Still to fetch: the office schedules SA102M / SA102MLA / SA102MP / SA102MSP / SA102(WAM).
