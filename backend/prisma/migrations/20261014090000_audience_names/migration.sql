-- Ticket audiences are shown as "Egyptian" and "Non-Egyptian" (the codes RESIDENT / VISITOR are unchanged).
UPDATE "ticket_audiences" SET "name_en" = 'Egyptian', "name_ar" = 'مصري' WHERE "code" = 'RESIDENT' AND "name_en" = 'Egyptian / resident';
UPDATE "ticket_audiences" SET "name_en" = 'Non-Egyptian', "name_ar" = 'غير مصري' WHERE "code" = 'VISITOR' AND "name_en" = 'Non-resident visitor';
