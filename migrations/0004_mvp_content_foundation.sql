-- Strengthen the two technical fixture problems while the reviewed 5–10 problem
-- MVP catalog remains an explicit content-approval blocker.
INSERT INTO test_cases (id, problem_id, input_data, expected_output, visibility) VALUES
  ('sum-odd-single-v1', 'sum-odd-positions-v1', '{"args":[[5]]}'::jsonb, '0'::jsonb, 'visible'),
  ('sum-odd-negative-v1', 'sum-odd-positions-v1', '{"args":[[4,-7,2,9,-3,-1]]}'::jsonb, '1'::jsonb, 'visible'),
  ('count-rises-empty-v1', 'count-rises-v1', '{"args":[[]]}'::jsonb, '0'::jsonb, 'visible'),
  ('count-rises-single-v1', 'count-rises-v1', '{"args":[[8]]}'::jsonb, '0'::jsonb, 'visible'),
  ('count-rises-descending-v1', 'count-rises-v1', '{"args":[[5,4,3,2]]}'::jsonb, '0'::jsonb, 'visible'),
  ('count-rises-mixed-v1', 'count-rises-v1', '{"args":[[1,3,2,4,4,7]]}'::jsonb, '3'::jsonb, 'visible');
