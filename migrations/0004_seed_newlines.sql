-- 0002 wrote '\n' inside standard (non-E) string literals, so the two authored
-- problems stored a literal backslash-n: the starter code was one line and a
-- Python SyntaxError. Restore real line breaks for those rows only.
UPDATE problems
   SET starter_code = replace(starter_code, '\n', E'\n'),
       reference_solution = replace(reference_solution, '\n', E'\n'),
       updated_at = now()
 WHERE id IN ('sum-odd-positions-v1', 'count-rises-v1')
   AND position(E'\n' IN starter_code) = 0;
