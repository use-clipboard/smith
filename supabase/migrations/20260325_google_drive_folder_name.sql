-- Add folder name column so Settings can display the selected Drive folder nicely
ALTER TABLE public.firm_settings ADD COLUMN IF NOT EXISTS google_drive_folder_name text;
