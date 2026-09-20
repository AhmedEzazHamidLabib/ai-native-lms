-- Real end-to-end rendering for PDF and DOCX materials (Part 2):
-- previously both kinds only stored the source file with zero
-- extraction, leaving students with a broken "— slides extracted"
-- message and no way to actually read the material. PDF needs no
-- conversion (the source IS the rendered artifact — reuses the
-- existing rendered_pdf_path column from 0025); DOCX gets a real
-- structured HTML extraction via mammoth, stored per version.

alter table material_versions add column if not exists extracted_html text;
