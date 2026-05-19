insert into ctsr_items (id, code, name_en, name_th, short_name, category, display_order)
values
  (1, 'agenda_setting', 'Agenda Setting and Adherence', 'การตั้งวาระและการดำเนินตาม', 'Agenda Setting', 'Structure', 1),
  (2, 'feedback', 'Feedback', 'การให้และรับฟีดแบ็ก', 'Feedback', 'Structure', 2),
  (3, 'collaboration', 'Collaboration', 'การร่วมมือ', 'Collaboration', 'Relationship', 3),
  (4, 'pacing', 'Pacing and Efficient Use of Time', 'จังหวะและการใช้เวลา', 'Pacing', 'Structure', 4),
  (5, 'interpersonal_effectiveness', 'Interpersonal Effectiveness', 'ประสิทธิผลระหว่างบุคคล', 'Interpersonal', 'Relationship', 5),
  (6, 'emotional_expression', 'Eliciting Appropriate Emotional Expression', 'การกระตุ้นการแสดงอารมณ์', 'Emotion', 'Relationship', 6),
  (7, 'key_cognitions', 'Eliciting Key Cognitions', 'การค้นหาความคิดสำคัญ', 'Key Cognitions', 'Technique', 7),
  (8, 'behaviours', 'Eliciting Behaviours', 'การค้นหาพฤติกรรม', 'Behaviours', 'Technique', 8),
  (9, 'guided_discovery', 'Guided Discovery', 'การชวนค้นพบ', 'Guided Discovery', 'Technique', 9),
  (10, 'conceptual_integration', 'Conceptual Integration', 'การบูรณาการแนวคิด', 'Conceptual Integration', 'Technique', 10),
  (11, 'change_methods', 'Application of Change Methods', 'การประยุกต์ใช้วิธีเปลี่ยนแปลง', 'Change Methods', 'Technique', 11),
  (12, 'homework_setting', 'Homework Setting', 'การมอบหมายการบ้าน', 'Homework', 'Technique', 12)
on conflict (id) do update set
  code = excluded.code,
  name_en = excluded.name_en,
  name_th = excluded.name_th,
  short_name = excluded.short_name,
  category = excluded.category,
  display_order = excluded.display_order;

insert into ctsr_rubric_anchors (ctsr_item_id, score, label)
select item.id, anchor.score, anchor.label
from ctsr_items item
cross join (
  values
    (0, 'Absent'),
    (1, 'Inappropriate'),
    (2, 'Novice'),
    (3, 'Adequate'),
    (4, 'Good'),
    (5, 'Very good'),
    (6, 'Excellent')
) as anchor(score, label)
on conflict (ctsr_item_id, score) do update set
  label = excluded.label;
