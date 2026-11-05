# Randomization Stage 2 — Module Documentation

Owner: Teammate 2 (`src/modules/randomization-stage-2/`). Module-local only.
No file outside this directory was created or modified.

## 1. What this module does

Forms polling parties from a **completed Stage 1 run's employee pool**:
1 Presiding Officer + 5 Polling Officers by default; 1 + 4 only with an
authorised shortage reason. Team sizes in one run:
- explicit `pollingOfficersPerParty: 4` + `shortageReason` → every party is
  1+4 (merged 3rd+4th duty on ONE person, no 4th role);
- `allowShortageFallback: true` + `shortageReason` → form full 1+5 parties
  first, then 1+4 parties (merged duty) from whoever is left; anyone still
  unfillable is reported, never forced.
Enforces seniority, distinct-office and work/native-Mandal-ban rules,
randomizes (Fisher-Yates, injectable RNG), assigns unique teamCodes for
Stage 3, returns Excel-ready rows (no Aadhaar/mobile). Preserves reserve status, reports unassigned +
unmet requirements, never silently relaxes a rule or claims complete on
failure.

## 2. Rules enforced

| Rule | Source |
|---|---|
| 1 PO + 5 POs; 1+4 only with authorised shortage reason | Circular p.2 [O] |
| PO seniority strictly above every PO in party (explicit rank) | Circular p.4 [O rule, U mapping] |
| Distinct offices per party | Circular p.4 [O] |
| No posting to work/native Mandal | Circular p.4 [O] |
| Only completed Stage 1 pool; never invent personnel | Workflow docs [D] |
| Unique teamCode per party for Stage 3 | Contract [P] |
| Reserve preserved; unmet reported; never silent relax | Brief [D] |

Seniority/PO-eligibility are REQUIRED explicit inputs (`seniorityRank`,
`presidingEligible`). Never inferred from pay or designation.

## 3. Inputs / outputs

Request: `{ stage1Run, employees, options }` (see `stage2.validator.js`).
Each party member carries `{ role, duty, personnelId, name, designation,
officeId, officeName, seniorityRank, classification }` where role is one of
`Presiding Officer | 1st..5th Polling Officer` (shortage 1+4: 1st, 2nd,
3rd-merged, 5th — no 4th role) and duty is the circular's verbatim duty
text for that numbered role (see `stage2.duties.js`; Presiding Officer duty
is null with `presidingDutyNeedsConfirmation: true` — the circular's
verified pages state no PO duty description, nothing invented).
Output: `{ status: completed|incomplete, parties[{teamCode,
postingMandal, members[], presidingDutyNeedsConfirmation}],
excelRows[], unassigned[], reserveHeld[],
unmetRequirements[], counts{} }`. Excel row keys: `teamCode, mandal,
role, duty, employeeId, name, designation, office`.

## 4. Manual check (fictional data, run from repo root)

```bash
node -e "const {formPollingParties}=require('./src/modules/randomization-stage-2'); const mk=(id,n,off,wm,nm,rank,po)=>({personnelId:id,name:n,designation:po?'Senior Assistant':'Junior Assistant',officeId:off,officeName:off,workMandal:wm,nativeMandal:nm,seniorityRank:rank,presidingEligible:po}); const E=[mk('E01','Asha Rao','OFF-A','W-A','N-A',1,true),mk('E02','Bhanu K','OFF-B','W-B','N-B',2,true),mk('E03','Chetan','OFF-C','W-C','N-C',5,false),mk('E04','Divya','OFF-D','W-D','N-D',6,false),mk('E05','Esha','OFF-E','W-E','N-E',7,false),mk('E06','Farhan','OFF-F','W-F','N-F',8,false),mk('E07','Gita','OFF-G','W-G','N-G',9,false),mk('E08','Hari','OFF-H','W-H','N-H',10,false),mk('E09','Irfan','OFF-I','W-I','N-I',11,false),mk('E10','Jaya','OFF-J','W-J','N-J',12,false),mk('E11','Kiran','OFF-K','W-K','N-K',13,false),mk('E12','Latha','OFF-L','W-L','N-L',14,false)]; const out=formPollingParties({stage1Run:{runId:'s1run-demo',electionConfigurationId:'ec-2026-001',districtId:'D1',stage:1,status:'completed'},employees:E,options:{partiesRequested:2,postingMandals:['M-Post-X','M-Post-Y']}}); console.log(out.status, out.parties.length+' parties', out.excelRows.length+' rows');"
```

## 5. Limitations (explicit, no other module touched)

- Enriched employee fields (office, mandals, seniorityRank,
  presidingEligible) must be resolved from personnel master keyed by
  Stage 1 `personnelId` (Phase 3, does not exist yet); this module takes
  them as validated input and fails closed when missing.
- No DB / migrations / Excel parsing / routes / app wiring (same dormant
  posture as Stage 1; `database/migrations/` untouched).
- Posting mandals come from `options.postingMandals`; per-mandal team
  quotas and the seniority/designation mapping need team ratification.
- Nothing committed, pushed, or published.

