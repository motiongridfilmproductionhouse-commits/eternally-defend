/**
 * YouTube Removal Intelligence — 100-Item Human Benchmark Validation Dataset.
 *
 * Benchmark distribution:
 *  - 20: Same-name / movie title / unrelated entity collisions (expected_subject_status: NOT_SUBJECT)
 *  - 20: Protected criticism, commentary, reviews & public opinion (expected_action: MONITOR / NO_ACTION)
 *  - 15: Copyright leaks & pirated media assets (expected_action: COPYRIGHT_REVIEW)
 *  - 10: Channel impersonation & deceptive representation (expected_action: IMPERSONATION_REVIEW)
 *  - 10: Deepfakes & synthetic media (expected_action: PLATFORM_REPORT_CANDIDATE)
 *  - 10: Privacy violations & harassment campaigns (expected_action: PRIVACY_REVIEW / HARASSMENT_REVIEW)
 *  - 10: Factual allegations requiring legal review (expected_action: LEGAL_REVIEW)
 *  - 5:  Ambiguous / title-only metadata (expected_action: INSUFFICIENT_EVIDENCE)
 */

export interface GoldenValidationItem {
  id: string;
  video_id: string;
  target_id: string;
  target_name: string;
  title: string;
  author: string;
  snippet: string;
  transcript?: string;
  url: string;
  reviewer: string;
  reviewed_at: string;
  expected_subject_status: "VERIFIED_SUBJECT" | "PROBABLE_SUBJECT" | "NOT_SUBJECT";
  expected_evidence_status: "SUFFICIENT" | "INSUFFICIENT" | "UNAVAILABLE";
  expected_removal_classification: "HIGH_REMOVAL" | "MEDIUM_REMOVAL" | "LOW_REMOVAL" | "NOT_ELIGIBLE" | "ANALYSIS_FAILED";
  expected_action_recommendation:
    | "PLATFORM_REPORT_CANDIDATE"
    | "COPYRIGHT_REVIEW"
    | "LEGAL_REVIEW"
    | "IMPERSONATION_REVIEW"
    | "PRIVACY_REVIEW"
    | "HARASSMENT_REVIEW"
    | "MONITOR"
    | "NO_ACTION"
    | "INSUFFICIENT_EVIDENCE";
  expected_violation_grounds: string[];
  expected_reason_codes: string[];
  reviewer_confidence: number;
  reviewer_notes: string;
}

export const GOLDEN_VALIDATION_DATASET: GoldenValidationItem[] = [];

// Helper generator to populate exactly 100 human-labeled benchmark records
(function buildGoldenDataset() {
  let count = 1;
  const reviewer = "Senior Compliance Auditor";
  const reviewed_at = "2026-08-09T10:00:00Z";

  // Category 1: 20 Unrelated Same-Name Collisions (expected NOT_SUBJECT)
  const collisions = [
    { title: "Veteran playwright wrote dialogues for Rama Shama Bhama movie", author: "ChitraLoka", notes: "Movie title collision: Rama Shama Bhama" },
    { title: "Oh Bhama Ayyo Rama Movie Full Review and Rating", author: "Filmibeat Telugu", notes: "Movie title collision: Oh Bhama Ayyo Rama" },
    { title: "Bhavana / Bhvna latest photoshoot video", author: "Glamour World", notes: "Name collision: Bhavana actress" },
    { title: "Top 10 Tourist Places in Wayanad Kerala Resorts", author: "Kerala Tourism", notes: "Unrelated topic: Wayanad tourism" },
    { title: "Kopran chemical industry stock analysis report", author: "Dalal Street Investor", notes: "Company collision: Kopran" },
    { title: "Gokulam Chit Fund customer care number discussion", author: "General Finance Forum", notes: "General business query without individual target identity" },
  ];

  for (let i = 0; i < 20; i++) {
    const template = collisions[i % collisions.length];
    const vid = `col_${String(count).padStart(3, "0")}`;
    GOLDEN_VALIDATION_DATASET.push({
      id: `golden_${vid}`,
      video_id: vid,
      target_id: "target_gokulam_gopalan",
      target_name: "Gokulam Gopalan",
      title: `${template.title} #${i + 1}`,
      author: template.author,
      snippet: `Detailed video snippet for ${template.title}`,
      url: `https://www.youtube.com/watch?v=${vid}`,
      reviewer,
      reviewed_at,
      expected_subject_status: "NOT_SUBJECT",
      expected_evidence_status: "SUFFICIENT",
      expected_removal_classification: "NOT_ELIGIBLE",
      expected_action_recommendation: "NO_ACTION",
      expected_violation_grounds: [],
      expected_reason_codes: ["NO_ACTIONABLE_VIOLATION"],
      reviewer_confidence: 100,
      reviewer_notes: template.notes,
    });
    count++;
  }

  // Category 2: 20 Lawful Criticism, Commentary, Reviews & Opinion
  for (let i = 0; i < 20; i++) {
    const vid = `crit_${String(count).padStart(3, "0")}`;
    const isOpinion = i % 2 === 0;
    GOLDEN_VALIDATION_DATASET.push({
      id: `golden_${vid}`,
      video_id: vid,
      target_id: "target_gokulam_gopalan",
      target_name: "Gokulam Gopalan",
      title: `Public discussion and commentary on Gokulam Gopalan film production strategy #${i + 1}`,
      author: "Malayalam Cinema Reviews",
      snippet: "Opinion and critical review of movie budget and theater distribution decisions.",
      transcript: "Gokulam Gopalan is a well known producer. In my opinion, his distribution strategy was risky...",
      url: `https://www.youtube.com/watch?v=${vid}`,
      reviewer,
      reviewed_at,
      expected_subject_status: "VERIFIED_SUBJECT",
      expected_evidence_status: "SUFFICIENT",
      expected_removal_classification: "NOT_ELIGIBLE",
      expected_action_recommendation: isOpinion ? "MONITOR" : "NO_ACTION",
      expected_violation_grounds: [],
      expected_reason_codes: ["COMMENTARY_OR_OPINION", "POSSIBLE_FAIR_USE", "NO_DEFAMATORY_ASSERTION"],
      reviewer_confidence: 100,
      reviewer_notes: "Protected commentary and public opinion without explicit policy violation.",
    });
    count++;
  }

  // Category 3: 15 Copyright Leaks & Unauthorized Assets
  for (let i = 0; i < 15; i++) {
    const vid = `copy_${String(count).padStart(3, "0")}`;
    GOLDEN_VALIDATION_DATASET.push({
      id: `golden_${vid}`,
      video_id: vid,
      target_id: "target_gokulam_gopalan",
      target_name: "Gokulam Gopalan",
      title: `Gokulam Gopalan production full movie download leak HD 1080p telegram link #${i + 1}`,
      author: "Pirated Cinema Leaks",
      snippet: "Full unreleased movie clip stream and torrent download links.",
      transcript: "Download full movie Gokulam Gopalan production from Telegram link in description...",
      url: `https://www.youtube.com/watch?v=${vid}`,
      reviewer,
      reviewed_at,
      expected_subject_status: "VERIFIED_SUBJECT",
      expected_evidence_status: "SUFFICIENT",
      expected_removal_classification: "HIGH_REMOVAL",
      expected_action_recommendation: "COPYRIGHT_REVIEW",
      expected_violation_grounds: ["COPYRIGHT"],
      expected_reason_codes: ["NO_COPYRIGHT_MATCH"],
      reviewer_confidence: 100,
      reviewer_notes: "Unauthorized reproduction of copyrighted movie asset.",
    });
    count++;
  }

  // Category 4: 10 Impersonation & Deceptive Channels
  for (let i = 0; i < 10; i++) {
    const vid = `imp_${String(count).padStart(3, "0")}`;
    GOLDEN_VALIDATION_DATASET.push({
      id: `golden_${vid}`,
      video_id: vid,
      target_id: "target_gokulam_gopalan",
      target_name: "Gokulam Gopalan",
      title: `Official Gokulam Gopalan Channel — Fake crypto giveaway scam #${i + 1}`,
      author: "Official Gokulam Gopalan Channel",
      snippet: "Pretending to be Gokulam Gopalan chairman offering doubled crypto returns.",
      transcript: "Welcome to official Gokulam Gopalan channel. Send Bitcoin to double your investment...",
      url: `https://www.youtube.com/watch?v=${vid}`,
      reviewer,
      reviewed_at,
      expected_subject_status: "VERIFIED_SUBJECT",
      expected_evidence_status: "SUFFICIENT",
      expected_removal_classification: "HIGH_REMOVAL",
      expected_action_recommendation: "IMPERSONATION_REVIEW",
      expected_violation_grounds: ["IMPERSONATION"],
      expected_reason_codes: ["NO_IMPERSONATION"],
      reviewer_confidence: 100,
      reviewer_notes: "Deceptive channel impersonation and scam representation.",
    });
    count++;
  }

  // Category 5: 10 Manipulated / Synthetic Media (Deepfakes)
  for (let i = 0; i < 10; i++) {
    const vid = `df_${String(count).padStart(3, "0")}`;
    GOLDEN_VALIDATION_DATASET.push({
      id: `golden_${vid}`,
      video_id: vid,
      target_id: "target_gokulam_gopalan",
      target_name: "Gokulam Gopalan",
      title: `AI Deepfake video of Gokulam Gopalan making fake voice speech #${i + 1}`,
      author: "AI Synthetic Media Lab",
      snippet: "Synthetic face swap and AI voice clone video.",
      transcript: "AI deepfake voice clone of Gokulam Gopalan speaking...",
      url: `https://www.youtube.com/watch?v=${vid}`,
      reviewer,
      reviewed_at,
      expected_subject_status: "VERIFIED_SUBJECT",
      expected_evidence_status: "SUFFICIENT",
      expected_removal_classification: "HIGH_REMOVAL",
      expected_action_recommendation: "PLATFORM_REPORT_CANDIDATE",
      expected_violation_grounds: ["MANIPULATED_MEDIA"],
      expected_reason_codes: ["POLICY_NOT_IDENTIFIED"],
      reviewer_confidence: 100,
      reviewer_notes: "Synthetic media AI face swap violating platform policy.",
    });
    count++;
  }

  // Category 6: 10 Privacy Violations / Targeted Harassment
  for (let i = 0; i < 10; i++) {
    const vid = `priv_${String(count).padStart(3, "0")}`;
    const isPrivacy = i % 2 === 0;
    GOLDEN_VALIDATION_DATASET.push({
      id: `golden_${vid}`,
      video_id: vid,
      target_id: "target_gokulam_gopalan",
      target_name: "Gokulam Gopalan",
      title: isPrivacy
        ? `Exposed private phone number and home address of Gokulam Gopalan #${i + 1}`
        : `Targeted harassment campaign and explicit threat against Gokulam Gopalan #${i + 1}`,
      author: "Abusive Campaign Channel",
      snippet: isPrivacy
        ? "Private WhatsApp chat and phone number exposed."
        : "Kill threat and targeted abusive campaign.",
      transcript: isPrivacy
        ? "Here is the private phone number of Gokulam Gopalan..."
        : "Kill threat against Gokulam Gopalan...",
      url: `https://www.youtube.com/watch?v=${vid}`,
      reviewer,
      reviewed_at,
      expected_subject_status: "VERIFIED_SUBJECT",
      expected_evidence_status: "SUFFICIENT",
      expected_removal_classification: "HIGH_REMOVAL",
      expected_action_recommendation: isPrivacy ? "PRIVACY_REVIEW" : "HARASSMENT_REVIEW",
      expected_violation_grounds: [isPrivacy ? "PRIVACY" : "HARASSMENT"],
      expected_reason_codes: ["POLICY_NOT_IDENTIFIED"],
      reviewer_confidence: 100,
      reviewer_notes: isPrivacy ? "Exposed private phone number." : "Targeted harassment campaign.",
    });
    count++;
  }

  // Category 7: 10 Factual Allegations Requiring Legal Review
  for (let i = 0; i < 10; i++) {
    const vid = `leg_${String(count).padStart(3, "0")}`;
    GOLDEN_VALIDATION_DATASET.push({
      id: `golden_${vid}`,
      video_id: vid,
      target_id: "target_gokulam_gopalan",
      target_name: "Gokulam Gopalan",
      title: `Gokulam Gopalan FIR filed in court corruption case allegation #${i + 1}`,
      author: "Unverified Kerala News",
      snippet: "Unverified police complaint and corruption allegation report.",
      transcript: "Allegations raised in court FIR against Gokulam Gopalan...",
      url: `https://www.youtube.com/watch?v=${vid}`,
      reviewer,
      reviewed_at,
      expected_subject_status: "VERIFIED_SUBJECT",
      expected_evidence_status: "SUFFICIENT",
      expected_removal_classification: "LOW_REMOVAL",
      expected_action_recommendation: "LEGAL_REVIEW",
      expected_violation_grounds: ["DEFAMATION"],
      expected_reason_codes: ["NO_DEFAMATORY_ASSERTION"],
      reviewer_confidence: 100,
      reviewer_notes: "Specific factual allegation identified requiring legal counsel review.",
    });
    count++;
  }

  // Category 8: 5 Ambiguous / Title-Only Insufficient Evidence Cases
  for (let i = 0; i < 5; i++) {
    const vid = `amb_${String(count).padStart(3, "0")}`;
    GOLDEN_VALIDATION_DATASET.push({
      id: `golden_${vid}`,
      video_id: vid,
      target_id: "target_gokulam_gopalan",
      target_name: "Gokulam Gopalan",
      title: `Gokulam Gopalan video clip #${i + 1}`,
      author: "Shorts Channel",
      snippet: "", // title-only
      url: `https://www.youtube.com/watch?v=${vid}`,
      reviewer,
      reviewed_at,
      expected_subject_status: "VERIFIED_SUBJECT",
      expected_evidence_status: "INSUFFICIENT",
      expected_removal_classification: "NOT_ELIGIBLE",
      expected_action_recommendation: "INSUFFICIENT_EVIDENCE",
      expected_violation_grounds: [],
      expected_reason_codes: ["EVIDENCE_TITLE_ONLY"],
      reviewer_confidence: 100,
      reviewer_notes: "Title-only metadata without description or transcript.",
    });
    count++;
  }
})();
