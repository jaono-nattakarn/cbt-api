export const CTSR_ITEMS = [
  { id: 1, code: "agenda_setting", nameEn: "Agenda Setting and Adherence", nameTh: "การตั้งวาระและการดำเนินตาม", shortName: "Agenda Setting", category: "Structure" },
  { id: 2, code: "feedback", nameEn: "Feedback", nameTh: "การให้และรับฟีดแบ็ก", shortName: "Feedback", category: "Structure" },
  { id: 3, code: "collaboration", nameEn: "Collaboration", nameTh: "การร่วมมือ", shortName: "Collaboration", category: "Relationship" },
  { id: 4, code: "pacing", nameEn: "Pacing and Efficient Use of Time", nameTh: "จังหวะและการใช้เวลา", shortName: "Pacing", category: "Structure" },
  { id: 5, code: "interpersonal_effectiveness", nameEn: "Interpersonal Effectiveness", nameTh: "ประสิทธิผลระหว่างบุคคล", shortName: "Interpersonal", category: "Relationship" },
  { id: 6, code: "emotional_expression", nameEn: "Eliciting Appropriate Emotional Expression", nameTh: "การกระตุ้นการแสดงอารมณ์", shortName: "Emotion", category: "Relationship" },
  { id: 7, code: "key_cognitions", nameEn: "Eliciting Key Cognitions", nameTh: "การค้นหาความคิดสำคัญ", shortName: "Key Cognitions", category: "Technique" },
  { id: 8, code: "behaviours", nameEn: "Eliciting Behaviours", nameTh: "การค้นหาพฤติกรรม", shortName: "Behaviours", category: "Technique" },
  { id: 9, code: "guided_discovery", nameEn: "Guided Discovery", nameTh: "การชวนค้นพบ", shortName: "Guided Discovery", category: "Technique" },
  { id: 10, code: "conceptual_integration", nameEn: "Conceptual Integration", nameTh: "การบูรณาการแนวคิด", shortName: "Conceptual Integration", category: "Technique" },
  { id: 11, code: "change_methods", nameEn: "Application of Change Methods", nameTh: "การประยุกต์ใช้วิธีเปลี่ยนแปลง", shortName: "Change Methods", category: "Technique" },
  { id: 12, code: "homework_setting", nameEn: "Homework Setting", nameTh: "การมอบหมายการบ้าน", shortName: "Homework", category: "Technique" },
] as const;

export const CTSR_ANCHORS = [
  { score: 0, label: "Absent", displayLabel: "Absent" },
  { score: 1, label: "Inappropriate", displayLabel: "Inappropriate" },
  { score: 2, label: "Novice", displayLabel: "Novice" },
  { score: 3, label: "Adequate", displayLabel: "Adequate" },
  { score: 4, label: "Good", displayLabel: "Good" },
  { score: 5, label: "Very good", displayLabel: "Very good" },
  { score: 6, label: "Excellent", displayLabel: "Excellent" },
] as const;

export function anchorLabel(score: number | null | undefined): string | null {
  if (score === null || score === undefined) return null;
  return CTSR_ANCHORS.find((anchor) => anchor.score === score)?.label ?? null;
}
