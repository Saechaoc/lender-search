import React, { useState, useCallback } from "react";

const SEED_LENDERS = [
  { id:"pennymac", name:"PennyMac TPO", type:"Wholesale" },
  { id:"prmg", name:"PRMG", type:"Wholesale/Retail/Correspondent" },
  { id:"champion", name:"Champions Funding LLC", type:"Non-QM" },
];

const SEED_PROGRAMS = [
  { id:"pm-fnma-conforming", lenderId:"pennymac", name:"Fannie Mae Conforming", shortName:"FNMA Standard & HB", agency:"Fannie Mae", aus:"DU", ausRequired:"Approve/Eligible", updatedDate:"02/09/2026", loanTypes:["Conventional"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home","Investment"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home","Rural"], ineligiblePropertyTypes:["Mobile Home","Co-op","Condotel","Timeshare","Geodesic Dome","Working Farm"], terms:["Fixed 8-30yr","5/6 ARM","7/6 ARM","10/6 ARM"], minFico:620, maxDti:null, dtiNote:"Per DU", highBalance:true, incomeLimit:null, manualUw:false, cashOutAllowed:true, armsAllowed:true,
    ltv:{ ownerOccupied:{ purchase:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95}, rateTerm:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95}, cashOut:{"1-unit":80,"2-4-unit":75} }, secondHome:{ purchase:{"1-unit":90}, rateTerm:{"1-unit":90}, cashOut:{"1-unit":75} }, investment:{ purchase:{"1-unit":85,"2-4-unit":75}, rateTerm:{"1-4-unit":75}, cashOut:{"1-unit":75,"2-4-unit":70} } },
    overlays:["Min 620 FICO required regardless of DU assessment","Manual underwriting not permitted","No frozen credit bureaus","VODs not acceptable for asset documentation","Handwritten third-party VOEs/VOM/VOR ineligible","Crypto/marijuana income ineligible for qualifying","AOL ineligible","LPMI: single premium only (broker only)","No Financed MI, Split Premium, Reduced MI, or Annual MI","Temp buydowns: min 660 FICO, seller/realtor-paid only, OO/2nd home only","Loans in forbearance ineligible","TX 50(a)(6): fixed rate, 1-unit OO, 80% LTV, full appraisal","HB/non-occupant co-borrower: max 95% LTV/CLTV"],
    derogatoryWaiting:{"Chapter 7/11 BK":"4 years","Chapter 13 BK":"2 yrs discharge / 4 yrs dismissal","Multiple BK":"5 years","Foreclosure":"7 years (3 w/ extenuating circumstances)","DIL/Short Sale/Charge-off":"4 years (2 w/ extenuating circumstances)"},
    ineligibleProducts:["HomeStyle Renovation","DU Refi Plus","Refi Plus","High LTV Refi","Single-Close Construction","3/6 SOFR ARM"],
    studentLoans:"1% of balance or fully amortizing if $0 on credit report" },

  { id:"pm-fhlmc-conforming", lenderId:"pennymac", name:"Freddie Mac Conforming", shortName:"FHLMC Standard & SC", agency:"Freddie Mac", aus:"LPA", ausRequired:"Accept (A-Minus not allowed)", updatedDate:"02/09/2026", loanTypes:["Conventional"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home","Investment"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home","Rural"], ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Geodesic Dome","Working Farm"], terms:["Fixed up to 30yr","5/6 ARM","7/6 ARM","10/6 ARM"], minFico:620, maxDti:50, dtiNote:"50% max on face of LPA", highBalance:true, incomeLimit:null, manualUw:false, cashOutAllowed:true, armsAllowed:true,
    ltv:{ ownerOccupied:{ purchase:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95}, rateTerm:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95}, cashOut:{"1-unit":80,"2-4-unit":75} }, secondHome:{ purchase:{"1-unit":90}, rateTerm:{"1-unit":90}, cashOut:{"1-unit":75} }, investment:{ purchase:{"1-unit":85,"2-4-unit":75}, rateTerm:{"1-4-unit":75}, cashOut:{"1-unit":75,"2-4-unit":70} } },
    overlays:["Min 620 FICO required","Manual UW not permitted; A-Minus not allowed","No frozen credit bureaus","VODs not acceptable","Handwritten VOEs/VOM/VOR ineligible","Crypto/marijuana income ineligible","AOL ineligible","LPMI not eligible on super conforming","Non-occupant co-borrowers ineligible on cash-out","Temp buydowns: 660+ FICO, seller-paid only, refi ineligible","7-10 financed properties: 720 FICO + LPA Accept required","5/6 ARM investment: max 1 financed investment property","Student loans ($0 CR): use 0.5% of balance"],
    derogatoryWaiting:{"All events":"No specific waiting periods — LPA Accept governs. All derog must appear on credit report."},
    ineligibleProducts:["CHOICERenovation","Enhanced LTV","GreenChoice","One-time Construction","3/6 SOFR ARM"],
    studentLoans:"0.5% of balance if $0 on credit report" },

  { id:"pm-homeready", lenderId:"pennymac", name:"HomeReady", shortName:"HomeReady (FNMA)", agency:"Fannie Mae", aus:"DU", ausRequired:"Approve/Eligible", updatedDate:"02/09/2026", loanTypes:["Conventional"], purposes:["Purchase","Rate/Term Refi"], occupancy:["Owner Occupied"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home","Rural"], ineligiblePropertyTypes:["Mobile Home","Co-op","Condotel","Timeshare","Geodesic Dome","Working Farm"], terms:["Fixed up to 30yr","5/6 ARM","7/6 ARM","10/6 ARM"], minFico:620, maxDti:null, dtiNote:"Per DU", highBalance:true, incomeLimit:"80% AMI", manualUw:false, cashOutAllowed:false, armsAllowed:true, maxFinancedProperties:2, reducedMI:true, llpasWaived:true,
    ltv:{ ownerOccupied:{ purchase:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95}, rateTerm:{"1-unit":97,"2-unit":95,"3-4-unit":95} }, secondHome:null, investment:null },
    overlays:["Min 620 FICO required","Manual UW not permitted","Max 2 financed properties","Cash-out not allowed","Cannot combine with any other special program","All appraisals require internal review","TX: OO refi — no cash back permitted","Temp buydowns: 660+ FICO, seller-paid only"],
    specialFeatures:["Boarder income up to 30% of qualifying income (12-month history required)","Cash on hand eligible for down payment on 1-unit","Reduced MI coverage","LLPAs waived","Homeownership education required if all occupying borrowers are FTHBs"] },

  { id:"pm-refinow", lenderId:"pennymac", name:"RefiNow", shortName:"RefiNow (FNMA)", agency:"Fannie Mae", aus:"DU", ausRequired:"Approve/Eligible", updatedDate:"02/09/2026", loanTypes:["Conventional"], purposes:["Rate/Term Refi"], occupancy:["Owner Occupied"], propertyTypes:["SFR","Condo","PUD","Manufactured Home","Rural"], ineligiblePropertyTypes:["2-4 Unit","Mobile Home","Co-op","Condotel"], terms:["Fixed Rate only"], minFico:620, maxDti:65, dtiNote:"65% max", highBalance:false, incomeLimit:"100% AMI", manualUw:false, cashOutAllowed:false, armsAllowed:false, maxCashBack:250, priorFannieLoanRequired:true, llpasWaived:true,
    ltv:{ ownerOccupied:{ rateTerm:{"1-unit":97} }, secondHome:null, investment:null },
    overlays:["Prior loan must be owned by Fannie Mae (12-month seasoning)","No adding borrowers — identical borrowers only","Max cash back $250 (excess applied as curtailment)","New sub financing only if replacing existing","TX 50(a)(6) not eligible","No temporary buydowns","Cannot combine with HomeReady","May only be used one time"],
    netTangibleBenefit:"Min 50bps rate reduction AND monthly payment reduction required" },

  { id:"pm-manufactured-home", lenderId:"pennymac", name:"Manufactured Home", shortName:"Manufactured Home (FNMA)", agency:"Fannie Mae", aus:"DU", ausRequired:"Approve/Eligible", updatedDate:"02/09/2026", loanTypes:["Conventional"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home"], propertyTypes:["Manufactured Home (multi-width only)"], ineligiblePropertyTypes:["Single-width MH","Mobile Home","2-4 Unit","Co-op","Working Farm"], terms:["Fixed Rate only (10,15,20,25,30yr)"], minFico:620, maxDti:null, dtiNote:"Per DU", highBalance:true, incomeLimit:null, manualUw:false, cashOutAllowed:true, armsAllowed:false,
    ltv:{ ownerOccupied:{ purchase:{"1-unit-mh-advantage":97,"1-unit-standard":95}, rateTerm:{"1-unit-mh-advantage":97,"1-unit-standard":95}, cashOut:{"1-unit":65} }, secondHome:{ purchase:{"1-unit":90}, rateTerm:{"1-unit":90}, cashOut:"Not Eligible" }, investment:"Not Eligible" },
    overlays:["Fixed rate only — no ARMs","No temporary buydowns","Full appraisal always required — no Value Acceptance","Multi-width only (min 12ft wide, 400 sqft)","Must be on permanent foundation, legally real property","ALTA Endorsement 7 required","Affidavit of affixture + title surrender required","Pennymac will NOT submit for PERS approval","Properties with ADUs ineligible","Previously moved homes ineligible"] },

  { id:"pm-va-full-doc", lenderId:"pennymac", name:"VA Full Doc", shortName:"VA Full Doc", agency:"VA", aus:"DU or LPA", ausRequired:"AUS Approval (ARM must use DU)", updatedDate:"02/09/2026", loanTypes:["VA"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home","Leasehold"], ineligiblePropertyTypes:["Co-op","Condotel","Hotel Condominium","Timeshare","Geodesic Dome","Working Farm","Land Trust","Mobile Home","Single-Width Manufactured Home"], terms:["Fixed 10-30yr","CMT ARM 5/1 (1/1/5 caps, DU only)"], minFico:580, maxDti:null, dtiNote:"Per AUS; >41% DTI requires 120% residual income; >$1.5M max 45%", highBalance:true, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":100,"2-4-unit":100}, rateTerm:{"1-unit":100}, cashOut:{"1-unit":90} }, secondHome:null, investment:null },
    ltvNotes:"Purchase/Type I LTV excludes financed VA funding fee. Type II cash-out max 90% includes financed funding fee. Loan amounts >$2M: purchase max 100%, cash-out max 80%. Loan amounts >$2.5M: purchase max 90%, cash-out max 80%.",
    ficoByLoanAmount:{"≤$1,000,000":{"purchase":580,"cashOutI":620,"cashOutII":620},"$1,500,000":{"purchase":680,"cashOutI":680,"cashOutII":680},"$2,000,000":{"purchase":700,"cashOutI":700,"cashOutII":700},"$2,500,000":{"purchase":720,"cashOutI":720,"cashOutII":720}},
    overlays:[
      "Borrower must be a veteran with a valid Certificate of Eligibility (COE) in Active or Pending status",
      "Min FICO 580 for purchase/Type I ≤$1M; 620 for cash-out Type II ≤$1M; higher minimums apply for larger loan amounts (see FICO by loan amount grid)",
      "No frozen credit bureaus — all bureaus must be unfrozen; AUS must be rerun with updated credit",
      "Non-traditional credit not allowed",
      "VODs not acceptable for asset documentation",
      "Handwritten third-party VOEs, VOM, and VOR ineligible in any circumstance",
      "Crypto/marijuana income ineligible for qualifying",
      "Condos must be VA approved; air condos without HOA and condo-hotels ineligible for VA approval",
      "Residual income required per VA regional table; 120% of required residual income when DTI >41%",
      "Sales concessions max 4% of VA NOV (does not include discount points or buyer closing costs)",
      "TX 50(a)(6) loans prohibited; Hawaii water catchment systems not allowed",
      "Escrow required for LTV >80% (>90% in CA) when FTHB, FICO <680, or CLTV >100%",
      "Temp buydowns: 660+ FICO (or FICO floor on grid), seller/realtor-paid only, fixed rate only, refi ineligible",
      "Cash-Out Type II: max $500K cash proceeds (excluding 2nd mortgage payoff); no multiple cash-outs within 12 months on same property",
      "Cash-Out Type I rate reduction: Fixed-to-Fixed min 0.5% reduction; Fixed-to-ARM min 2% reduction; ARM-to-Fixed no minimum",
      "Loan amounts >$1.5M: AUS approval required, max DTI 45%, full entitlement required, 0x30x12 mortgage history for last 12 consecutive months",
      "Manual UW: permitted for loan amounts ≤$1.5M only; 660+ FICO (purchase/Type I) or 700+ FICO (Type II); 0x30x12; max DTI 45%",
      "Joint loans: only eligible for veteran + veteran-spouse (both using entitlement) or veteran + other veteran(s); all other joint loans ineligible",
      "CEMA not eligible",
      "Pre-payment penalties not permitted",
      "Forbearance: if subject or any obligated mortgage shows forbearance, loan is ineligible"
    ],
    derogatoryWaiting:{"Chapter 7 BK":"2 years (no conditions); 1–2 years with extenuating circumstances + 2 tradelines re-established (0x30x12); <12 months not allowed","Chapter 13 BK":"12 months under payment plan with BK judge approval, OR plan completed","Foreclosure":"2 years (no conditions); 1–2 years with extenuating circumstances + 2 tradelines re-established (0x30x12)","Deed in Lieu / Short Sale":"No mandatory waiting period if borrower payment history was unaffected and borrower was cooperating with servicer; otherwise apply foreclosure seasoning"},
    ineligibleProducts:["IRRRL (covered under separate profile)","Single-close construction-to-perm","Energy Efficient Mortgage","Graduated Payment Mortgage","All ARMs except CMT 5/1"],
    studentLoans:"Follow VA Lenders Handbook; include any payment shown on credit report; if $0 use 5% of balance ÷ 12",
    specialFeatures:["No down payment required for eligible veterans with full entitlement","VA funding fee may be financed into loan","Funding fee waived for veterans with service-connected disability, surviving spouses receiving DIC, and active duty Purple Heart recipients","No mortgage insurance (MI) required","No maximum number of financed properties","Two-time close construction-to-perm refinances eligible up to 100% LTV","Buyer-broker charges permitted on purchases (per VA Aug 2024 policy)"] },

  { id:"pm-va-irrrl", lenderId:"pennymac", name:"VA IRRRL", shortName:"VA IRRRL", agency:"VA", aus:"None", ausRequired:"N/A — AUS not utilized", updatedDate:"02/09/2026", loanTypes:["VA"], purposes:["Rate/Term Refi"], occupancy:["Owner Occupied","Second Home"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home"], ineligiblePropertyTypes:["Co-op","Condotel","Hotel Condominium","Timeshare","Geodesic Dome","Working Farm","Land Trust","Mobile Home","Single-Width Manufactured Home"], terms:["Fixed 10-30yr","CMT ARM 5/1 (1/1/5 caps; ineligible on MH)"], minFico:580, maxDti:null, dtiNote:"DTI not calculated for IRRRL", highBalance:true, incomeLimit:null, manualUw:true, cashOutAllowed:false, armsAllowed:true,
    ltv:{ ownerOccupied:{ rateTerm:{} }, secondHome:{ rateTerm:{} }, investment:null },
    ltvNote:"No maximum LTV. Exception: NTB discount point scenarios may require LTV <100% or <90% confirmed by appraisal.",
    overlays:[
      "VA-to-VA refinance only — existing loan must be a VA-guaranteed loan",
      "No COE required; evidence of funding fee exemption status required if applicable",
      "FICO: no minimum for port loans; 580 min non-port non-MH (≤$1M); 640 min non-port MH (≤$1M); 680/700/720 for $1.5M/$2M/$2.5M non-port",
      "Non-port loans >$1.5M: 0x30x12 primary mortgage/housing history required for most recent 12 consecutive months",
      "Subject mortgage: 0x30 for last 3 payments required (port and non-port)",
      "Seasoning: first payment due date 210+ days before note date AND at least 6 full consecutive payments made on loan being refinanced",
      "AUS not utilized — manual underwriting only",
      "DTI ratios not calculated",
      "No source of funds or reserves required",
      "Max $100 cash back to borrower (only for: computational errors, payoff changes, upfront fees financed into loan, or escrow balance transfer)",
      "Temporary interest rate buydowns not allowed",
      "No new subordinate financing allowed; existing sub financing must be subordinated",
      "Rate reduction required: Fixed-to-Fixed min 0.5%; Fixed-to-ARM min 2%; ARM-to-Fixed and ARM-to-ARM exempt",
      "Fee recoupment: max 36 months from note date; comparison statement signed by veteran required",
      "If P&I stays same or increases: borrower may incur no fees/closing costs (except taxes, escrow, VA funding fee)",
      "If PITI increases 20%+: lender certification required confirming veteran qualifies for new payment",
      "Condominium projects: VA project approval not required (unlike VA Full Doc)",
      "Second home: 1-unit only; veteran must certify prior occupancy of the property as primary residence",
      "Manufactured home: multi-width only, min 700 sqft, 1-unit, permanently affixed, built after 6/15/1976; no ARM; leasehold ineligible",
      "Borrowers: only spouses may be added; borrowers may be removed per VA requirements; surviving spouse on original note may be eligible",
      "TX 50(a)(6) refinances prohibited; CT and ME HPML loans not allowed; Flint MI water test required (veteran may not pay)",
      "Florida non-port: current AVM or appraisal required for all loans"
    ],
    derogatoryWaiting:{"All events":"No specific waiting periods — AUS not used. Subject mortgage must show 0x30 for last 3 payments. Active Chapter 13 BK: eligible with documented BK court/trustee permission."},
    ineligibleProducts:["3/1, 7/1, 10/1 CMT ARMs","Energy Efficient Mortgages","Temporary buydowns","Single-close construction loans"],
    specialFeatures:["No maximum LTV","DTI not calculated","No reserves or source of funds required","Condominium projects not required to be VA approved","Second homes eligible (1-unit, prior occupancy certification required)","Surviving spouse of veteran may be eligible to IRRRL","Single-bureau soft-pull credit report acceptable as minimum","Manufactured homes eligible (multi-width, ≥700 sqft, post-6/15/1976, fixed rate only)"] },

  { id:"pm-va-mh", lenderId:"pennymac", name:"VA Manufactured Home", shortName:"VA Manufactured Home", agency:"VA", aus:"DU or LPA", ausRequired:"AUS Approval required", updatedDate:"02/09/2026", loanTypes:["VA"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied"], propertyTypes:["Manufactured Home"], ineligiblePropertyTypes:["Single-Width Manufactured Home","Mobile Home","Co-op","Condotel","Hotel Condominium","Timeshare","Working Farm","Land Trust","Leasehold"], terms:["Fixed Rate only (10, 15, 20, 25, 30yr)"], minFico:640, maxDti:null, dtiNote:"Per AUS; >41% requires 120% residual income; >$1.5M max 45%", highBalance:true, incomeLimit:null, manualUw:false, cashOutAllowed:true, armsAllowed:false,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":100}, rateTerm:{"1-unit":80}, cashOut:{"1-unit":80} }, secondHome:null, investment:null },
    ltvNotes:"Purchase max 100% (excl. funding fee); drops to 90% at $2.5M loan amount. Cash-out Type I and Type II both capped at 80% (incl. funding fee) — more restrictive than standard VA. Min FICO tiers: 640 (≤$1M), 680 ($1.5M), 700 ($2M), 720 ($2.5M) for both purchase and cash-out.",
    overlays:[
      "Multi-width manufactured homes only — minimum 700 sqft",
      "Must be permanently affixed to land and legally classified as real property; fee simple land ownership only — no leasehold",
      "Unit must not have been previously installed or occupied at any other site (initial dealer/manufacturer delivery exempt)",
      "Towing hitch, wheels, and axles must be removed",
      "Min FICO 640 (≤$1M); 680 ($1.5M); 700 ($2M); 720 ($2.5M) — higher than standard VA Full Doc",
      "Cash-out max 80% LTV (incl. funding fee) for both Type I and Type II — more restrictive than VA Full Doc (90%)",
      "Full 1004C/70B appraisal required; condition rating must be C4 or better — no ACE/AVM waivers",
      "Appraisal must include min 2 manufactured home comparables; photos of HUD Data Plate and HUD Certification Label required",
      "Foundation must meet Permanent Foundation Guide for Manufactured Housing (PFGMH); engineer certification required if appraiser cannot confirm",
      "ALTA Endorsement 7, 7.1, or 7.2 (or equivalent state form) required",
      "Affidavit of Affixture required; evidence of vehicular title surrender or certificate of title with land ownership indicated required",
      "Manufactured home rider to security instrument required",
      "Property description on security instrument must match affidavit of affixture exactly (year, make, VIN, legal description)",
      "Manual underwriting not allowed",
      "ARM transactions not eligible — fixed rate only",
      "Escrow holdbacks not allowed",
      "No frozen credit bureaus — all bureaus must be unfrozen; AUS must be rerun",
      "Non-traditional credit not allowed",
      "VODs not acceptable for asset documentation",
      "Handwritten third-party VOEs, VOM, and VOR ineligible in any circumstance",
      "Crypto/marijuana income ineligible for qualifying",
      "Residual income required per VA regional table; 120% of required residual income when DTI >41%",
      "Sales concessions max 4% of VA NOV",
      "TX 50(a)(6) refinances prohibited; Hawaii water catchment systems not allowed",
      "Temp buydowns: 660+ FICO (or FICO floor on grid, whichever is greater), seller/realtor-paid only, fixed rate, refi ineligible",
      "Loan amounts >$1.5M: max DTI 45% regardless of AUS, 0x30x12 mortgage/housing history required for last 12 consecutive months",
      "New construction: Certificate of Occupancy (or equivalent) required by loan close"
    ],
    derogatoryWaiting:{"Chapter 7 BK":"2 years (no conditions); 1–2 years with extenuating circumstances + 2 tradelines re-established (0x30x12); <12 months not allowed","Chapter 13 BK":"12 months under payment plan with BK judge approval, OR plan completed","Foreclosure":"2 years (no conditions); 1–2 years with extenuating circumstances + 2 tradelines re-established (0x30x12)","Deed in Lieu / Short Sale":"No mandatory waiting period if payment history unaffected and borrower cooperated with servicer; otherwise apply foreclosure seasoning"},
    ineligibleProducts:["ARM transactions","Single-close construction-to-perm","Alterations and Repairs loans","Energy Efficient Mortgages","Graduated Payment Mortgages"],
    studentLoans:"Follow VA Lenders Handbook; include any payment shown on credit report; if $0 use 5% of balance ÷ 12",
    specialFeatures:["No mortgage insurance required","VA funding fee may be financed","Funding fee waived for service-connected disability veterans, DIC surviving spouses, Purple Heart active duty","No maximum number of financed properties","Two-time close construction-to-perm refinances eligible up to 100% LTV","Buyer-broker charges permitted on purchases (per VA Aug 2024 policy)"] },

  { id:"pm-fha", lenderId:"pennymac", name:"FHA", shortName:"FHA", agency:"FHA", aus:"FHA TOTAL Scorecard", ausRequired:"TOTAL Accept; Refer permitted with manual UW", updatedDate:"03/05/2026", loanTypes:["FHA"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home","Rural"], ineligiblePropertyTypes:["Single-Width Manufactured Home","Mobile Home","Co-op","Condotel","Hotel Condominium","Timeshare","Geodesic Dome","Working Farm","Land Trust"], terms:["Fixed 10-30yr","CMT ARM 5/1 (1/1/5 caps, margin 1.75%)"], minFico:580, maxDti:null, dtiNote:"Per TOTAL or FHA manual UW requirements", highBalance:true, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":96.5,"2-4-unit":96.5}, rateTerm:{"1-unit":97.75,"2-4-unit":97.75}, cashOut:{"1-unit":80,"2-4-unit":80} }, secondHome:null, investment:null },
    ltvNotes:"Manual UW min FICO is 640. Rate/term max LTV drops to 85% if borrower has not occupied as primary for 12 months. Identity-of-interest transactions max 85% LTV. DPA: no max CLTV (govt entity), 100% (family member), 96.5% (all others).",
    overlays:[
      "Min FICO 580 (TOTAL Scorecard); min FICO 640 for manual underwriting",
      "Nonpermanent resident aliens ineligible — U.S. citizens and permanent resident aliens only",
      "No frozen credit bureaus — all bureaus must be unfrozen; AUS must be rerun with updated credit",
      "All loans must be submitted through FHA TOTAL Mortgage Scorecard; Refer requires manual UW",
      "Manual UW required for Refer/downgrade: loans with disputed derogatory accounts ≥$1,000 must be downgraded to Refer",
      "Escrow impound account required for ALL loans (taxes and insurance) — no exceptions",
      "Financing concessions max 6% of sales price",
      "HPML: fixed rate only — not eligible on ARMs",
      "Condominiums: must be FHA approved; DELRAP approvals ineligible; Pennymac single-unit approvals eligible",
      "VODs not acceptable for asset documentation",
      "Handwritten third-party VOEs, VOM, and VOR ineligible in any circumstance",
      "Crypto/virtual currency income, RSU income, and marijuana income ineligible for qualifying",
      "Self-employed: >20% income decline over analysis period makes borrower ineligible for FHA",
      "Boarder income: min 680 FICO, max 15% of total effective income, 9-month payment history required; ineligible on manual UW loans",
      "ADU rental income: max 30% of qualifying income; full appraisal required; 2 months PITIA reserves required; ineligible on cash-out refi",
      "3-4 unit properties: 3 months PITIA reserves required after closing",
      "Cash-out: property must be OO for 12 months prior to case number assignment; min 6 months mortgage payments on current loan; no multiple cash-outs on same property within 12 months",
      "Cash-out: non-occupant co-borrowers may not be added; non-occupant co-borrower income ineligible",
      "Rate/term: max $500 cash back to borrower; partial claims may not be paid off with refi proceeds",
      "Rate/term: 85% LTV if borrower has not occupied property as primary for 12 months prior to case number",
      "Seasoning for refi: 6 consecutive monthly payments + first payment due date 210+ days before new loan's first payment due date",
      "Property flipping: no FHA financing within 90 days of seller acquisition; if 91-180 days and resale price ≥100% over acquisition price, second appraisal by different appraiser required (broker pays)",
      "Identity-of-Interest transactions: max 85% LTV (exceptions per 4000.1 II.A.2.b.ii)",
      "Temp buydowns: min 660 FICO, purchase only (not refi), seller/realtor-paid only, fixed rate only",
      "TX 50(a)(6) refinances prohibited",
      "Negative equity refinance: borrower ineligible for cash-out on same property for 4 years from completion"
    ],
    derogatoryWaiting:{"Chapter 7 / Chapter 13 BK":"2 years from case number assignment date (discharged)","Foreclosure / Deed-in-Lieu":"3 years from case number assignment; period begins on date of DIL or date borrower transferred title","Short Sale":"3 years from case number assignment; period begins on date of title transfer"},
    mortgagePaymentHistory:{"Purchase / Rate-Term":"No 3x30, 1x60, or worse in most recent 12 months; borrower must have made at least 3 consecutive payments since completing forbearance","Cash-Out":"No current delinquency; no delinquency within 12 months of case number assignment; min 12 consecutive payments since forbearance completion"},
    ineligibleProducts:["3/1, 7/1, 10/1 CMT ARMs","FHA Title 1","Simple Refinances","Energy Efficient Mortgages","Weatherization / Solar / Wind programs","Graduated Payment Mortgages","One- and two-time close construction programs"],
    studentLoans:"Follow FHA Handbook 4000.1 requirements",
    specialFeatures:["Low down payment — 3.5% minimum (580+ FICO)","Down payment assistance eligible (no max CLTV for government entity DPA)","Non-occupant co-borrowers permitted on purchase and rate/term refi","FHA mortgage insurance (UFMIP + annual MIP) required","High balance loan limits by county (see HUD website)","ADU rental income eligible on purchase and rate/term refi (max 30% of income)","Boarder income eligible on TOTAL loans with 680+ FICO (max 15% of income)"] },

  { id:"pm-fha-streamline", lenderId:"pennymac", name:"FHA Streamline Refinance", shortName:"FHA Streamline", agency:"FHA", aus:"None", ausRequired:"N/A — TOTAL not used; not submitted to TOTAL", updatedDate:"05/27/2025", loanTypes:["FHA"], purposes:["Rate/Term Refi"], occupancy:["Owner Occupied","Investment"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home"], ineligiblePropertyTypes:["Mobile Home","Co-op","Condotel","Hotel Condominium","Timeshare","Geodesic Dome","Working Farm","Land Trust"], terms:["Fixed 10-30yr","CMT ARM 5/1 (1/1/5 caps; ineligible on MH)"], minFico:580, maxDti:null, dtiNote:"DTI not calculated (standard streamline); 31%/43% with compensating factors if credit qualifying", highBalance:true, incomeLimit:null, manualUw:true, cashOutAllowed:false, armsAllowed:true,
    ltv:{ ownerOccupied:{ rateTerm:{} }, secondHome:null, investment:{ rateTerm:{} } },
    ltvNote:"No maximum LTV/CLTV. No maximum CLTV based on original appraised value. New subordinate financing allowed per FHA requirements.",
    overlays:[
      "FHA-to-FHA refinance only — existing FHA-insured loan required",
      "TOTAL Mortgage Scorecard not used — manual process only",
      "No appraisal required for standard streamline (exceptions: MH port loans, certain NTB scenarios)",
      "No LTV/CLTV cap",
      "Min FICO 580 (non-MH); min FICO 620 (manufactured home, port loans only)",
      "Manufactured homes: port (existing Pennymac) loans only; min 620 FICO; 12-month seasoning on existing loan; no ARMs; exterior inspection or prior appraisal from Pennymac systems required; ALTA 7 endorsement required",
      "Non-manufactured home streamline: DTI not calculated; income documentation minimal (VVOE for salaried, 3rd-party business verification for self-employed, award letter/bank statement for retirement)",
      "Credit qualifying streamline: full FHA 203(b) derogatory credit review and DTI 31%/43% (with compensating factors) apply; TOTAL still not used",
      "Subject mortgage payment history: 0x30 in last 6 months; max 1x30 in months 7-12 prior to case number assignment; payment must be current month prior to disbursement",
      "Seasoning: min 6 payments made + 6 full months since first payment due date + 210 days from closing of loan being refinanced",
      "NTB — Fixed-to-Fixed: new combined rate (interest + MIP) ≥0.5% below prior combined rate",
      "NTB — Fixed-to-ARM: new combined rate ≥2% below prior combined rate",
      "NTB — ARM-to-Fixed: new combined rate ≤2% above prior AND term reduced by min 3 years AND PI+MIP increase ≤$50/month",
      "NTB — ARM-to-ARM: new combined rate ≥1% below prior combined rate",
      "NTB based on modified payment/interest when existing loan has been modified",
      "Max cash back to borrower: $350 (for post-approval changes only)",
      "Secondary residences NOT eligible (owner-occupied and investment only)",
      "Borrower removal: allowed without credit qualifying only in divorce or death (with specific documentation); otherwise credit qualifying required",
      "Borrowers can be added without credit qualifying as long as existing borrowers remain on note and deed",
      "Nonpermanent resident aliens ineligible",
      "CAIVRS check not required (unlike FHA full doc); LDP and GSA lists must still be reviewed",
      "Condominiums: project approval NOT required",
      "Escrow impound required for ALL loans (taxes and insurance)",
      "Temporary buydowns not allowed",
      "Loan term: lesser of 30 years OR remaining term of existing loan plus 12 years",
      "TX 50(a)(6) refinances prohibited; West Virginia properties not allowed; Maine HPML not allowed (non-credit qualifying only)",
      "VODs not acceptable for asset documentation; handwritten VOM and VOR ineligible",
      "Reserves not required; funds to close must be verified only if they exceed the new mortgage payment"
    ],
    derogatoryWaiting:{"All events (standard streamline)":"No specific derogatory waiting periods for standard (non-credit qualifying) streamlines beyond subject mortgage payment history requirements","All events (credit qualifying)":"Follow Pennymac FHA 203(b) Product Profile derogatory credit requirements","Active Chapter 13 BK":"Eligible with documented permission from BK court/trustee","Judgments on title":"Must be paid or in payment plan with lien subordinated (min 3 timely payments required)","Judgments on credit":"No action required"},
    ineligibleProducts:["Energy Efficient Mortgages","Weatherization / Solar / Wind programs","3/1, 7/1, 10/1 CMT ARMs","Temporary buydowns","Non-port manufactured home streamlines"],
    specialFeatures:["No appraisal required (standard streamline)","No LTV/CLTV cap","No maximum CLTV based on original appraised value","Investment properties eligible (based on current use, not original occupancy)","Condominium projects not required to be FHA approved","Borrowers can be added without credit qualifying","CAIVRS check not required","Reserves not required","New subordinate financing allowed per FHA requirements","Manufactured homes eligible for port loans only (620+ FICO, 12-month seasoning)"] },

  { id:"pm-fha-mh", lenderId:"pennymac", name:"FHA Manufactured Home", shortName:"FHA MH", agency:"FHA", aus:"FHA TOTAL Scorecard", ausRequired:"TOTAL Accept; manual UW permitted (640 FICO min)", updatedDate:"03/05/2026", loanTypes:["FHA"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied"], propertyTypes:["Manufactured Home (multi-width only)"], ineligiblePropertyTypes:["Single-Width Manufactured Home","Mobile Home","Co-op","2-4 Unit","Working Farm","Land Trust","Leasehold"], terms:["Fixed Rate only (10-30yr)"], minFico:620, maxDti:null, dtiNote:"Per TOTAL; manual UW 640+ FICO; DTI >50% requires 640 FICO or LTV 5% below max", highBalance:true, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:false,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":96.5}, rateTerm:{"1-unit":97.75}, cashOut:{"1-unit":80} }, secondHome:null, investment:null },
    ltvNotes:"Purchase 96.5% (620 FICO TOTAL; 640 manual). Rate/Term 97.75% (620 TOTAL; 640 manual). Cash-Out 80% (640 FICO for both TOTAL and manual). DTI >50%: 640 FICO or LTV 5% below program max. Cash-out: property must have been erected on current site for 12+ months.",
    overlays:[
      "Multi-width manufactured homes only — minimum 700 sqft",
      "Owner-occupied principal residence only — no second homes or investment properties",
      "Must be permanently affixed to permanent foundation and legally classified as real property; fee simple land ownership required — no leaseholds",
      "Unit must not have been previously installed, occupied, or moved from another site (initial dealer/factory-to-site delivery exempted)",
      "Towing hitch, wheels, and axles must be removed",
      "No ARMs — fixed rate only",
      "Min FICO 620 (TOTAL Scorecard); min FICO 640 for manual underwriting",
      "Cash-out: property must have been erected on current site for minimum 12 months prior to case number assignment",
      "DTI >50%: borrower must have 640+ FICO OR reduce LTV by 5% below program maximum",
      "Full 1004C/70B appraisal always required — no appraisal waivers or ACE",
      "Appraisal must include minimum 2 manufactured home comparables",
      "Photos of HUD Data Plate and HUD Certification Label required in appraisal",
      "Foundation must meet Permanent Foundations Guide for Manufactured Housing (PFGMH); engineer certification required if appraiser cannot confirm compliance",
      "ALTA Endorsement 7 (or state equivalent) required",
      "Affidavit of Affixture required; evidence of vehicular title surrender required",
      "Manufactured home rider to security instrument required",
      "Escrow holdbacks not allowed",
      "Single-unit condo approvals ineligible (unlike standard FHA 203(b))",
      "Condominiums: FHA-approved projects only; DELRAP approvals ineligible",
      "Flood zone: finished grade elevation at or above 100-year return frequency flood elevation required",
      "Mobile home parks where borrower does not own underlying land are ineligible",
      "Lava zones 1 and 2 (Hawaii) ineligible",
      "Nonpermanent resident aliens ineligible — U.S. citizens and permanent resident aliens only",
      "No frozen credit bureaus — all bureaus must be unfrozen; AUS must be rerun",
      "All loans must be submitted through FHA TOTAL Mortgage Scorecard; Refer requires manual UW",
      "Escrow impound account required for ALL loans (taxes and insurance)",
      "Financing concessions max 6% of sales price",
      "VODs not acceptable for asset documentation",
      "Handwritten third-party VOEs, VOM, and VOR ineligible in any circumstance",
      "Crypto/virtual currency income, RSU income, and marijuana income ineligible for qualifying",
      "Temp buydowns: min 660 FICO, purchase only, seller/realtor-paid only, fixed rate only",
      "TX 50(a)(6) refinances prohibited",
      "Property flipping rules apply: no FHA financing within 90 days of seller acquisition; 91-180 days with resale price ≥100% over acquisition requires second appraisal"
    ],
    derogatoryWaiting:{"Chapter 7 / Chapter 13 BK":"2 years from case number assignment date (discharged)","Foreclosure / Deed-in-Lieu":"3 years from case number assignment; period begins on date of DIL or date borrower transferred title","Short Sale":"3 years from case number assignment; period begins on date of title transfer"},
    mortgagePaymentHistory:{"Purchase / Rate-Term":"No 3x30, 1x60, or worse in most recent 12 months","Cash-Out":"No current delinquency; no delinquency within 12 months of case number assignment; min 12 consecutive payments since forbearance completion"},
    ineligibleProducts:["ARM transactions","Single-unit condo approvals","FHA 203(k) Rehabilitation","Energy Efficient Mortgages","One- and two-time close construction programs"],
    studentLoans:"Follow FHA Handbook 4000.1 requirements",
    specialFeatures:["Low down payment — 3.5% minimum (620+ FICO TOTAL; 640 manual)","FHA mortgage insurance (UFMIP + annual MIP) required","High balance loan limits by county","Manual underwriting permitted (640+ FICO)","Full appraisal required — HUD Data Plate and Certification Label photos must be included","PFGMH foundation certification required"] },

  { id:"pm-home-possible", lenderId:"pennymac", name:"Home Possible", shortName:"Home Possible (FHLMC)", agency:"Freddie Mac", aus:"LPA", ausRequired:"Accept", updatedDate:"02/09/2026", loanTypes:["Conventional"], purposes:["Purchase","Rate/Term Refi"], occupancy:["Owner Occupied"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home","Rural","Leasehold"], ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Geodesic Dome","Working Farm","Hotel Condominium","Land Trust"], terms:["Fixed up to 30yr","5/6 ARM","7/6 ARM","10/6 ARM"], minFico:620, maxDti:50, dtiNote:"50% max on face of LPA", highBalance:true, incomeLimit:"80% AMI", manualUw:false, cashOutAllowed:false, armsAllowed:true, maxFinancedProperties:2, reducedMI:true, llpasWaived:true,
    ltv:{ ownerOccupied:{ purchase:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95}, rateTerm:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95} }, secondHome:null, investment:null },
    superConformingLtv:{"2-unit":85,"3-4-unit":80},
    overlays:[
      "Min 620 FICO required (AUS Cert)",
      "Manual UW not permitted; LPA A-Minus not allowed",
      "No frozen credit bureaus — all bureaus must be unfrozen; LPA must be rerun with updated credit",
      "VODs not acceptable for asset documentation",
      "Handwritten third-party VOEs, VOM, and VOR ineligible in any circumstance",
      "Crypto/marijuana income ineligible for qualifying",
      "LPMI: single premium eligible on standard conforming only — not eligible on super conforming",
      "Max 2 financed residential properties including subject property",
      "Cash-out not allowed",
      "80% AMI income limit — qualifying income must not exceed 80% of area median income",
      "TX 50(a)(6) refinances not allowed; 50(f)(2) ineligible; no cash back on OO refi",
      "Escrow required for LTV >80% (>90% in CA) when: FTHB, FICO below 680, or CLTV >97%",
      "Non-occupying co-borrower: 1-unit only, max 95% LTV/TLTV, must share eligible gift donor relationship",
      "Homeownership education required for all FTHBs on purchase transactions (before note date)",
      "Landlord education required for 2-4 unit purchase transactions (before note date)",
      "Temp buydowns: 660+ FICO, seller/realtor-paid only, refi ineligible, fixed + 7/6 & 10/6 ARM only, 1-2 units only, manufactured homes ineligible",
      "3/6 SOFR ARM ineligible; GreenChoice, CHOICERenovation, Enhanced LTV, one-time close construction ineligible",
      "Derogatory: no specific waiting periods — LPA Accept governs; all derog events must appear on credit report",
      "Forbearance: if subject or any obligated mortgage shows forbearance, loan is ineligible",
      "Cash on hand not an eligible source of funds for closing",
      "Sweat equity not an eligible source of funds"
    ],
    derogatoryWaiting:{"All events":"No specific waiting periods — LPA Accept governs. All derogatory events must appear on credit report. If derog not on report, manual UW required (not offered by Pennymac)."},
    ineligibleProducts:["3/6 SOFR ARM","GreenChoice","CHOICERenovation","Enhanced LTV","One-time Close Construction"],
    studentLoans:"0.5% of outstanding balance if $0 on credit report; otherwise use credit report amount",
    boarderIncome:"Eligible up to 30% of qualifying income; 12-month co-residency and payment history required; must continue residing in new home",
    specialFeatures:["Reduced MI coverage (standard coverage required)","Homeownership education required for FTHBs","Boarder income up to 30% of qualifying income","Down payment assistance via gifts, grants, employer assistance, and affordable seconds eligible","Non-occupying co-borrower permitted on 1-unit at max 95% LTV"] },

  { id:"pm-dscr", lenderId:"pennymac", name:"Non-QM DSCR", shortName:"DSCR", agency:"Non-QM", aus:"None", ausRequired:"N/A — manual underwriting only; AUS not utilized", updatedDate:"12/24/2025", loanTypes:["DSCR"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Investment"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Leasehold"], ineligiblePropertyTypes:["Manufactured Home","Mobile Home","Co-op","Condotel","Timeshare","Working Farm","Rural"], terms:["Fixed 15yr","Fixed 30yr","Fixed IO 30yr (10yr IO)","Fixed IO 40yr (10yr IO)","5/6 ARM (2-1-5)","7/6 ARM (5-1-5)","10/6 ARM (5-1-5)","ARM IO 5/6, 7/6, 10/6"], minFico:660, maxDti:null, dtiNote:"DTI not calculated — DSCR ratio used instead. Min DSCR 0.75 or No Ratio option available.", highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:125000, maxLoanAmount:2000000,
    minDscr:0.75, prepayIneligibleStates:["AK","KS","MD","MI","MN","NM","RI","VA"], prepayRestrictedStates:["IL","NJ","OH","PA"],
    ioRules:{ minFico:700, maxLtv:75, notes:"No Ratio ineligible for IO; max 75% LTV (DSCR≥1.0), 70% (DSCR≥0.75)" },
    ltv:{ ownerOccupied:null, secondHome:null, investment:{ purchase:{"1-unit":80,"2-4-unit":75,"warrantable-condo":75,"non-warrantable-condo":75}, rateTerm:{"1-unit":80,"2-4-unit":75,"warrantable-condo":75}, cashOut:{"1-unit":75,"2-4-unit":75} } },
    ltvNotes:"LTV is tiered by DSCR ratio, loan amount, and FICO. DSCR>=1.00 Purchase/RT: max 80% ($1M loan, 720 FICO); 75% ($1.5M, 700 FICO or $1M, 680); 70% ($2M, 700 or $1.5M, 680 or $1M, 660); 65% ($2M, 680 or $1.5M, 660); 60% ($2M, 660). Cash-out: max 75% ($1M, 740/720 FICO); 70% ($1.5M, 740/720 or $2M, 740); 65% ($1M, 680 or $1.5M, 700); 60% ($1.5M/2M, 720/700 or $1M, 660). DSCR 0.75–1.00: max 75% ($1M-$2M range, 700–740 FICO). No Ratio: max 75% purch ($1M-$1.5M, 720+ FICO). Declining markets: reduce max LTV by 5 points. 2-4 unit/condo: max 75%. Cash-out: LTV >60% max $500K proceeds; LTV ≤60% no limit. Short-term rental: max 70% LTV. IO: max 75% (DSCR>=1.0) or 70% (DSCR>=0.75). Non-perm resident aliens: max 75%, no cash-out.",
    overlays:[
      "Investment property only — all borrowers must execute Occupancy Certification; no primary or second home occupancy (max 14 days/year personal use)",
      "Professional investors only: 12 months experience owning/managing income-producing real estate within past 36 months (LOE required); first-time investors: min 700 FICO, DSCR > 1.0",
      "First-time homebuyers ineligible (no borrower or guarantor may be a FTHB)",
      "Non-permanent resident aliens: max 75% LTV/CLTV, no cash-out",
      "Max 20 financed residential 1-4 unit properties per borrower/guarantor; max 10 with Pennymac / $7.5M UPB Pennymac-serviced",
      "Min FICO 660 (loan amounts up to $2M — see LTV notes for full FICO/loan amount/DSCR matrix)",
      "No frozen credit bureaus — tri-merge required; all bureaus must be unfrozen",
      "Credit re-scores not allowed (except documented error correction)",
      "Housing payment history: 0x30x12 required for subject property and each borrower's/guarantor's primary residence",
      "Payments missed under forbearance count as late payments for housing payment history",
      "No income or employment documentation required — DSCR qualifying based on rental income / PITIA",
      "DSCR = Gross Rental Income ÷ PITIA; min DSCR 0.75 or No Ratio option available",
      "Rental income: lower of executed lease agreement or 1007/1025 market rent (lease may be used if higher, with 3 months documented receipt)",
      "Short-term rental (Airbnb/VRBO): eligible at max 70% LTV, DSCR >=1.0 only; must be legally permitted and confirmed by appraiser",
      "Interest only: min 700 FICO; max 75% LTV (DSCR>=1.0), max 70% LTV (DSCR>=0.75), not eligible for No Ratio option",
      "Temporary interest rate buydowns not eligible",
      "Subordinate financing not permitted",
      "Non-arm's length transactions ineligible (including family sales, estate sales, employer/employee sales)",
      "Cash-out: business purpose only (LOE required detailing purpose and use of proceeds); min 12-month ownership; 6-month seasoning between cash-out refis",
      "Cash-out: LTV >60% max $500K proceeds; LTV ≤60% no limit",
      "Escrow impound waivers eligible (LLPA adjustment applies)",
      "Prepayment penalty available (1–5 year term); not allowed in AK, KS, MD, MI, MN, NM, RI, VA; state restrictions apply in IL, NJ, OH, PA",
      "Property inspection waivers not eligible; one full appraisal required ≤$2M; two full appraisals >$2M",
      "All appraisals require secondary valuation (CU/LCA ≤2.5, CDA/ARR, or field review) unless second full appraisal obtained",
      "ARM index: 30-Day Average SOFR; margin 5.00%; lookback 45 days; adjustment period 6 months; floor = margin",
      "Rural properties ineligible (defined by appraiser in Neighborhood Characteristic Location)",
      "Entities (LLC, LP, GP, Corp) permitted — max 4 entity owners; personal guaranty required; all guarantors must have ≥25% ownership; layered entities up to 2 layers allowed (entities layered with trust ineligible)",
      "CEMA: refinance only; lost note affidavits not allowed",
      "OFAC screening required for all borrowers/guarantors, property sellers, and settlement agents",
      "Tax transcripts (4506-C) not required",
      "Rent loss insurance required: min 6 months of local average monthly rents",
      "GSE ineligibility documentation required in all loan files (DU/LPA findings or 1008)"
    ],
    derogatoryWaiting:{"Foreclosure / Short Sale / Pre-Foreclosure / DIL":"36 months from property resolution date to note date","Chapter 7/11/13 BK":"36 months from discharge/dismissal date to note date; multiple BKs not permitted","Modifications (due to default)":"36 months from modification signing date","Notice of Default or Lis Pendens":"36 months from notice date","120+ Day Delinquency":"36 months from date brought current","Balloon payment >180 days past maturity":"36 months from balloon payment date"},
    ineligibleProducts:["Assignment of contracts","Construction loans","Builder bailout / conversion loans","Lease option","Daily simple interest loans","eMortgages / eNotarization","Escrow holdbacks"],
    specialFeatures:["No income or employment documentation required","DSCR qualifying (gross rent ÷ PITIA)","No Ratio option available","Short-term rental income eligible (Airbnb/VRBO; max 70% LTV)","Interest only option available (min 700 FICO)","Entity borrowers permitted (LLC, LP, GP, Corp)","Prepayment penalty available","Escrow waiver eligible","Crypto assets eligible for down payment and reserves (if converted to USD)","Business assets eligible for down payment (50%+ ownership required)","Cash-out proceeds can satisfy reserve requirement"] },

  { id:"pm-nonqm-aminus", lenderId:"pennymac", name:"Non-QM A-", shortName:"Non-QM A-", agency:"Non-QM", aus:"None", ausRequired:"N/A — manual underwriting only; AUS not utilized", updatedDate:"12/24/2025", loanTypes:["Non-QM"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home","Investment"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Leasehold","Rural"], ineligiblePropertyTypes:["Manufactured Home","Mobile Home","Co-op","Condotel","Timeshare","Working Farm"], terms:["Fixed 15yr","Fixed 30yr","5/6 ARM (2-1-5)","7/6 ARM (5-1-5)","10/6 ARM (5-1-5)"], minFico:660, maxDti:45, dtiNote:"Max 45% DTI; non-occupant co-borrower: max 43% DTI (occupying borrower max 75%)", highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:150000, maxLoanAmount:2000000,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":85,"2-unit-4-unit":75,"warrantable-condo":75,"non-warrantable-condo":75}, rateTerm:{"1-unit":85,"2-4-unit":75}, cashOut:{"1-unit":75,"2-4-unit":75} }, secondHome:{ purchase:{"1-unit":80}, rateTerm:{"1-unit":80}, cashOut:{"1-unit":70} }, investment:{ purchase:{"1-unit":80,"2-4-unit":75}, rateTerm:{"1-unit":80,"2-4-unit":75}, cashOut:{"1-unit":70,"2-4-unit":65} } },
    ltvNotes:"LTV tiered by loan amount and FICO. OO Purch/RT: 85% ($1M, 720+); 80% ($1.5M, 720+); 75% ($2M, 720+ or $1.5M, 700+); 75% ($1.5M, 680 or $1M, 660). OO Cash-out: 75% ($1M, 720); 70% ($1.5M, 720/700 or $1M, 680); 65% ($1.5M, 680 or $1M, 660); 60% ($1.5M, 660). 2H Purch/RT: 80% ($1M, 660+); 75% ($1.5M, 660+). 2H Cash-out: 70% ($1M, 660+); 65% ($1.5M, 660+). Inv Purch/RT: 80% ($1M, 700+); 75% ($1.5M, 700+ or $1M, 660+); 70% ($1.5M, 680/660). Inv Cash-out: 70% ($1M, 720+); 65% ($1.5M, 720+/$1M,700/660). Declining markets: -5%. Rural OO: max 75%, no cash-out; Rural 2H: max 70%; Rural Inv: ineligible. Cash-out: LTV>60% max $250K proceeds.",
    overlays:[
      "Manual underwriting only — AUS not utilized",
      "Min FICO 660 across all occupancies; see LTV notes for FICO/loan amount tiering",
      "Max loan $2M (OO); $1.5M (second home/investment)",
      "Max DTI 45%; non-occupant co-borrower: max 43% DTI with max 75% DTI for occupying borrower",
      "Interest only not eligible",
      "Temporary interest rate buydowns: eligible on OO and second home only — not on investment",
      "No frozen credit bureaus — tri-merge required; all bureaus must be unfrozen",
      "Housing payment history: max 2x30x12 and 1x60x24 across all REOs and rental payments; must be evidenced by 24-month payment history",
      "Payments missed under forbearance count as late payments",
      "Non-occupant co-borrower: 1-unit OO only; max 43% DTI; max 75% LTV; 6 months additional reserves; no cash-out",
      "Non-permanent resident aliens: max 75% LTV, no cash-out",
      "Max 20 financed residential 1-4 unit properties; max 10 / $7.5M UPB with Pennymac",
      "2-4 units and condos (warrantable/non-warrantable): max 75% LTV",
      "Rural: OO max 75% no cash-out; second home max 70%; investment ineligible",
      "Cash-out: LTV >60% max $250K; LTV ≤60% no limit",
      "Reserves: 3 months PITIA required for all loan amounts",
      "Income documentation: Standard (24-month full doc), Streamline (12-month), Bank Statements (12 or 24 months), or 1099",
      "WVOE and asset depletion ineligible",
      "Bank statement income: 12 or 24 months consecutive required; not eligible for 1099 borrowers from single employer",
      "Self-employed: 25%+ ownership; 2 years business history required",
      "Gift funds on second home: not permitted if LTV >80%; investment: not permitted if LTV >80%",
      "Non-arm's length transactions ineligible",
      "Prepayment penalty available (not permitted on investment cash-out for personal use); state restrictions apply",
      "Property inspection waivers not eligible; full appraisal required; secondary valuation required on single-appraisal transactions",
      "GSE ineligibility documentation required in all loan files",
      "OFAC screening required for all borrowers/guarantors, sellers, and settlement agents",
      "Payment shock: max 250% (unless borrower living rent-free)"
    ],
    derogatoryWaiting:{"Foreclosure / Short Sale / Pre-Foreclosure / DIL":"24 months from property resolution date","Chapter 7/11/13 BK":"24 months from discharge/dismissal; multiple BKs not permitted","Modifications (due to default)":"24 months from modification signing date","Notice of Default or Lis Pendens":"24 months from notice date","120+ Day Delinquency":"24 months from date brought current"},
    ineligibleProducts:["Interest only","Assignment of contracts","Construction loans","Builder bailout","Conversion loans","Lease option","Daily simple interest loans","eMortgages / eNotarization"],
    specialFeatures:["Alt doc eligible: bank statements (12 or 24 months), 1099, streamline (12-month)","Non-occupant co-borrower permitted (1-unit OO, max 75% LTV)","Rural properties eligible (OO and second home with restrictions)","Non-warrantable condos eligible (max 75% LTV)","Prepayment penalty available","Temp buydowns on OO and second home","Business assets eligible for down payment (50%+ ownership)","Entity borrowers not specified — see DSCR program for entity transactions"] },

  { id:"pm-nonqm-a", lenderId:"pennymac", name:"Non-QM A", shortName:"Non-QM A", agency:"Non-QM", aus:"None", ausRequired:"N/A — manual underwriting only; AUS not utilized", updatedDate:"12/24/2025", loanTypes:["Non-QM"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home","Investment"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Leasehold","Rural"], ineligiblePropertyTypes:["Manufactured Home","Mobile Home","Co-op","Condotel","Timeshare","Working Farm"], terms:["Fixed 15yr","Fixed 30yr","Fixed IO 30yr (10yr IO)","5/6 ARM (2-1-5)","7/6 ARM (5-1-5)","10/6 ARM (5-1-5)","ARM IO 5/6, 7/6, 10/6"], minFico:660, maxDti:50,
    ioRules:{ minFico:700, maxLtv:80 }, dtiNote:"Max 50% DTI; non-occupant co-borrower: max 43% DTI (occupying borrower max 75%)", highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:150000, maxLoanAmount:3000000,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":90,"2-4-unit":80,"warrantable-condo":80,"non-warrantable-condo":75}, rateTerm:{"1-unit":90,"2-4-unit":80}, cashOut:{"1-unit":75,"2-4-unit":75} }, secondHome:{ purchase:{"1-unit":85}, rateTerm:{"1-unit":85}, cashOut:{"1-unit":75} }, investment:{ purchase:{"1-unit":85,"2-4-unit":80}, rateTerm:{"1-unit":85,"2-4-unit":80}, cashOut:{"1-unit":75,"2-4-unit":70} } },
    ltvNotes:"LTV tiered by loan amount and FICO. OO Purch/RT: 90% ($1M, 740+); 85% ($1.5M, 740+/$1M, 700+); 80% ($2M, 740+/720+/700+/$1.5M, 680+); 75% ($2.5M, 740+/720+/700+/$2M, 680+/$1.5M, 660+/$1M, 660+). OO Cash-out: 75% ($1.5M, 740+/720+/700+/$1M, 680+); 70% ($2M, 740+/720+/700+/$1.5M, 680+); 65% ($2.5M, 740+/720+/700+/$2M, 680+/$1.5M, 660+); 60% ($3M, 740+/$2.5M, 680+/$2M, 660+). 2H/Inv Purch: similar tiers with max 85%. Cash-out: LTV>60% max $500K. IO: min 700 FICO, max 80% LTV. Asset depletion: max 85% LTV, 700 FICO, no cash-out, OO only. WVOE: max 75% LTV, 660 FICO. Declining markets: -5%. Rural: OO max 75% no cash-out; 2H max 70%; Inv ineligible.",
    overlays:[
      "Manual underwriting only — AUS not utilized",
      "Min FICO 660 across all occupancies; see LTV notes for full FICO/loan amount/LTV tiering",
      "Max loan $3M (OO and investment); $3M (second home)",
      "Max DTI 50%; non-occupant co-borrower: max 43% DTI with max 75% DTI for occupying borrower",
      "Interest only: min 700 FICO, max 80% LTV",
      "Temporary interest rate buydowns: eligible on OO and second home only",
      "No frozen credit bureaus — tri-merge required; all bureaus must be unfrozen",
      "Housing payment history: max 1x30x12 and 0x60x24 across all REOs and rental payments (stricter than A- program)",
      "Payments missed under forbearance count as late payments",
      "Non-occupant co-borrower: 1-unit OO only; max 43% DTI; max 75% LTV; 6 months additional reserves; no cash-out",
      "Non-permanent resident aliens: max 75% LTV, no cash-out",
      "Max 20 financed residential 1-4 unit properties; max 10 / $7.5M UPB with Pennymac",
      "2-4 units and warrantable condos: max 80% LTV; non-warrantable condos: max 75% LTV",
      "Rural: OO max 75% no cash-out; second home max 70%; investment ineligible",
      "Cash-out: LTV >60% max $500K; LTV ≤60% no limit",
      "Reserves: 3 months (≤$1M); 6 months ($1M-$2M); 9 months (>$2M)",
      "Income documentation: Standard (24-month), Streamline (12-month), Bank Statements (12 or 24 months), 1099, Asset Depletion, WVOE",
      "Asset depletion: max 85% LTV, min 700 FICO, no cash-out, primary residence only",
      "WVOE: max 75% LTV, min 660 FICO",
      "Self-employed: 25%+ ownership; 2 years business history required",
      "Gift funds on second home: not permitted if LTV >80%",
      "Non-arm's length transactions ineligible",
      "Prepayment penalty available; state restrictions apply (not permitted on investment cash-out for personal use)",
      "Property inspection waivers not eligible; full appraisal required; secondary valuation required on single-appraisal transactions",
      "Two full appraisals required for loan amounts >$2M",
      "ARM index: 30-Day Average SOFR; margin 4.50%; lookback 45 days; floor = margin",
      "GSE ineligibility documentation required in all loan files",
      "OFAC screening required for borrowers, sellers, and settlement agents",
      "Payment shock: max 250% (unless rent-free)"
    ],
    derogatoryWaiting:{"Foreclosure / Short Sale / Pre-Foreclosure / DIL":"36 months from property resolution date","Chapter 7/11/13 BK":"36 months from discharge/dismissal; multiple BKs not permitted","Modifications (due to default)":"36 months from modification signing date","Notice of Default or Lis Pendens":"36 months from notice date","120+ Day Delinquency":"36 months from date brought current"},
    ineligibleProducts:["Assignment of contracts","Construction loans","Builder bailout","Conversion loans","Lease option","Daily simple interest loans","eMortgages / eNotarization"],
    specialFeatures:["Higher LTVs than A- (up to 90% OO purchase)","Interest only eligible (min 700 FICO, max 80% LTV)","Max loan $3M","Max DTI 50%","Asset depletion income eligible (OO, no cash-out, 700 FICO, max 85% LTV)","WVOE eligible (max 75% LTV, 660 FICO)","Alt doc: bank statements (12/24 months), 1099, streamline (12-month)","Non-occupant co-borrower permitted (1-unit OO, max 75% LTV)","Non-warrantable condos eligible (max 75% LTV)","Temp buydowns on OO and second home","Prepayment penalty available"] },

  { id:"pm-nonqm-aplus", lenderId:"pennymac", name:"Non-QM A+", shortName:"Non-QM A+", agency:"Non-QM", aus:"None", ausRequired:"N/A — manual underwriting only; AUS not utilized", updatedDate:"12/24/2025", loanTypes:["Non-QM"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home","Investment"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Leasehold","Rural"], ineligiblePropertyTypes:["Manufactured Home","Mobile Home","Co-op","Condotel","Timeshare","Working Farm"], terms:["Fixed 15yr","Fixed 30yr","Fixed IO 30yr (10yr IO)","5/6 ARM (2-1-5)","7/6 ARM (5-1-5)","10/6 ARM (5-1-5)","ARM IO 5/6, 7/6, 10/6"], minFico:660, maxDti:55,
    ioRules:{ minFico:700, maxLtv:85 }, dtiNote:"Max 50% DTI standard; DTI 50-55% requires 700 FICO, max 80% LTV, OO only, no FTHB, 1.5x residual income. Non-occupant co-borrower: max 43% DTI (occupying borrower max 75%).", highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:150000, maxLoanAmount:3500000,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":90,"2-4-unit":85,"warrantable-condo":85,"non-warrantable-condo":80}, rateTerm:{"1-unit":90,"2-4-unit":85}, cashOut:{"1-unit":80,"2-4-unit":80} }, secondHome:{ purchase:{"1-unit":85}, rateTerm:{"1-unit":85}, cashOut:{"1-unit":75} }, investment:{ purchase:{"1-unit":85,"2-4-unit":85}, rateTerm:{"1-unit":85,"2-4-unit":85}, cashOut:{"1-unit":75,"2-4-unit":75} } },
    ltvNotes:"LTV tiered by loan amount and FICO. OO Purch/RT: 90% ($1M, 740+); 85% ($2M, 740+ or $1.5M, 720+/700+/$1M, 680+/660+); 80% ($2.5M, 740+/720+/700+/$2M, 680+/660+); 75% ($3M, 740+/720+/700+); 70% ($3M, 700/$2.5M, 680/660); 65% ($3.5M, 740). OO Cash-out: 80% ($1M, 740); 75% ($2M, 740+ or $1.5M, 720+/700+); 70% ($2.5M, 740+/720+/$2M, 700+/$1.5M, 680+/660+); 65% ($3M, 740+/720+/$2.5M, 700+/$2M, 680); 60% ($3M, 700/$2.5M, 680/$2M, 660). 2H/Inv Purch: similar pattern with max 85%. IO: max 85% LTV, min 700 FICO. DTI>50% to 55%: max 80% LTV, 700 FICO, OO only. WVOE: max 80% LTV. Asset depletion: max 85% LTV, 700 FICO, no cash-out, OO only. Non-perm aliens: max 80% LTV. Non-occupant co-borrower: max 80% LTV. Declining markets: -5%. Rural: OO max 75%, no cash-out; 2H max 70%; Inv ineligible. Cash-out: LTV>60% max $750K.",
    overlays:[
      "Manual underwriting only — AUS not utilized",
      "Min FICO 660; see LTV notes for full FICO/loan amount tiering",
      "Max loan $3.5M (OO purchase); $3M (second home/investment and OO cash-out)",
      "Max DTI 50% standard; DTI 50–55% requires min 700 FICO, max 80% LTV, OO only, no FTHB, 1.5x required residual income",
      "Interest only: min 700 FICO, max 85% LTV (highest IO LTV in Non-QM suite)",
      "Temporary interest rate buydowns: eligible on OO and second home only",
      "No frozen credit bureaus — tri-merge required; all bureaus must be unfrozen",
      "Housing payment history: 0x30x12 and 0x60x24 across all REOs/rental payments — cleanest tier (no late payments in 12 months)",
      "Payments missed under forbearance count as late payments",
      "Non-occupant co-borrower: 1-unit OO only; max 43% DTI; max 80% LTV; 6 months additional reserves; no cash-out",
      "Non-permanent resident aliens: max 80% LTV, no cash-out",
      "Max 20 financed residential 1-4 unit properties; max 10 / $7.5M UPB with Pennymac",
      "2-4 units and warrantable condos: max 85% LTV; non-warrantable condos: max 80% LTV",
      "Rural: OO max 75% no cash-out; second home max 70%; investment ineligible",
      "Cash-out: LTV >60% max $750K; LTV ≤60% no limit",
      "Reserves: 6 months (≤$1M); 9 months ($1M-$2M); 12 months (>$2M) — highest reserves in Non-QM suite",
      "Income documentation: Standard (24-month), Streamline (12-month), Bank Statements (12 or 24 months), 1099, Asset Depletion, WVOE",
      "Asset depletion: max 85% LTV, min 700 FICO, no cash-out, primary residence only",
      "WVOE: max 80% LTV, min 660 FICO",
      "Self-employed: 25%+ ownership; 2 years business history required",
      "Gift funds on second home: not permitted if LTV >80%",
      "Non-arm's length transactions ineligible",
      "Prepayment penalty available; state restrictions apply (not permitted on investment cash-out for personal use)",
      "Property inspection waivers not eligible; full appraisal required; secondary valuation required",
      "Two full appraisals required for loan amounts >$2M",
      "ARM index: 30-Day Average SOFR; margin 4.00% (lowest in Non-QM suite); lookback 45 days; floor = margin",
      "GSE ineligibility documentation required in all loan files",
      "OFAC screening required for borrowers, sellers, and settlement agents",
      "Payment shock: max 250% (unless rent-free)"
    ],
    derogatoryWaiting:{"Foreclosure / Short Sale / Pre-Foreclosure / DIL":"48 months from property resolution date","Chapter 7/11/13 BK":"48 months from discharge/dismissal; multiple BKs not permitted","Modifications (due to default)":"48 months from modification signing date","Notice of Default or Lis Pendens":"48 months from notice date","120+ Day Delinquency":"48 months from date brought current"},
    ineligibleProducts:["Assignment of contracts","Construction loans","Builder bailout","Conversion loans","Lease option","Daily simple interest loans","eMortgages / eNotarization"],
    specialFeatures:["Premium Non-QM tier — highest LTVs and loan amounts","Max loan $3.5M","IO up to 85% LTV (highest in Non-QM suite)","DTI up to 55% (with residual income overlay)","Max cash-out proceeds $750K (LTV >60%)","Lowest ARM margin (4.00%)","Non-warrantable condos up to 80% LTV","Non-occupant co-borrower up to 80% LTV","Asset depletion income eligible","WVOE eligible (max 80% LTV)","Alt doc: bank statements (12/24 months), 1099, streamline","Temp buydowns on OO and second home","Prepayment penalty available"] },

  { id:"pm-optima-jumbo", lenderId:"pennymac", name:"Optima Non-AUS Jumbo", shortName:"Optima Jumbo", agency:"Jumbo", aus:"None", ausRequired:"N/A — manual underwriting only; AUS findings ineligible", updatedDate:"03/16/2026", loanTypes:["Jumbo"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home","Investment"], propertyTypes:["SFR","Condo","2-4 Unit","PUD"], ineligiblePropertyTypes:["Manufactured Home","Mobile Home","Co-op","Condotel","Timeshare","Working Farm","Leasehold","Non-Warrantable Condo","Land Trust"], terms:["Fixed 15yr","Fixed 30yr"], minFico:720, maxDti:43, dtiNote:"43% max (OO ≤$1.5M, 720 FICO); 41% ($2M+ OO); 40% (investment); see matrix for full FICO/loan/DTI tiers", highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:false, minLoanAmount:null, maxLoanAmount:2500000,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":80,"2-unit":80}, rateTerm:{"1-unit":80,"2-unit":80}, cashOut:{"1-unit":70} }, secondHome:{ purchase:{"1-unit":75}, rateTerm:{"1-unit":75}, cashOut:null }, investment:{ purchase:{"1-unit":65}, rateTerm:{"1-unit":65}, cashOut:null } },
    ltvNotes:"Min loan: $1 above conforming standard loan limit. LTV by loan amount and FICO: OO 1-unit Purch/RT: 80% ($1.5M, 720 FICO, 43% DTI, 12mo reserves); 80% ($2M, 740 FICO, 41% DTI, 18mo reserves); 75% ($2.5M, 760 FICO, 41% DTI, 36mo reserves); 70% ($2.5M, 760 FICO, 41% DTI, 24mo reserves). OO cash-out: 70% ($1.5M, 740); 65% ($2M, 740); max $500K cash-out. 2-unit OO: 80% ($2M, 740, 41%). Second home Purch/RT: 75% ($2M, 740, 43%, 18mo); 70% ($2.5M, 760, 43%, 18mo); no cash-out. Investment Purch/RT: 65% ($1.5M, 760, 40%, 36mo); no cash-out. Non-perm resident aliens: max 70% LTV, 1-unit primary only. Soft/depreciating market: -5%; rapidly depreciating: -10%.",
    overlays:[
      "Broker channel only — NonDel+ ineligible",
      "Manual underwriting only — AUS findings not eligible",
      "Qualified Mortgage (QM) / Safe Harbor — all loans must meet General QM requirements",
      "Fixed rate only — no ARMs, no interest only, no temp buydowns",
      "Min loan: $1 above the conforming standard loan limit; max loan: $2.5M",
      "Full documentation income only — no bank statements, no alt doc",
      "Min FICO 720 (OO $1.5M); 740 ($2M OO and second home); 760 ($2.5M and all investment)",
      "Housing payment history: 0x30x24 — zero lates in 24 months; 24-month mortgage/rental history required",
      "7-year seasoning required for: BK, foreclosure, short sale, NOD, DIL, loan modification, consumer credit counseling",
      "Max financed properties: 4 (including subject); Pennymac-financed UPB cap: $5M",
      "Non-permanent resident aliens: 1-unit primary only; max 70% LTV; 24-month US employment history; no additional financed properties",
      "First-time homebuyers: primary purchase only; max $1M ($1.5M in CA/CT/NJ/NY/WA); min 720 FICO; 30-year fixed only; no gift funds; min 12 (or 15 in FTHB states) months reserves",
      "Non-occupant co-borrowers ineligible; non-resident borrowers and foreign nationals ineligible",
      "Condominiums: warrantable only; Fannie Mae CPM and Freddie Mac CPA review required; limited review ineligible; investment condos ineligible in GA and FL; site condos allowed OO only",
      "Non-arm's length transactions ineligible (family sales, flips, estate, employer/employee, renter/landlord)",
      "Cash-out: OO only, max $500K; min 6-month ownership; property cannot be currently listed or listed within 6 months",
      "Cash-out: inherited properties ineligible within 12 months ownership; cash-back cannot be used as reserves",
      "Gift funds: primary residence purchase only; not for second home, investment, reserves, payoff of debt, or equity gifts",
      "Min borrower contribution: 5% if OO LTV ≤70%; 10% if OO LTV >70%; own funds required for second home and investment (all LTVs)",
      "IPC max: 6% (OO and second home); 2% investment",
      "HPML and high-cost loans ineligible",
      "Two appraisals required for loan amounts >$1.5M; transferred appraisals and recertifications not acceptable",
      "Reserves: per matrix (12–36 months subject property); additional reserves for multiple financed properties; gift funds, cash-out proceeds, and business funds ineligible for reserves; retirement accounts usable at 60% of vested balance",
      "No delayed financing; no CEMA; no one-time close construction",
      "Funds from People's Republic of China (including Hong Kong/Taiwan) ineligible for assets or income",
      "Two-year tax transcripts required when tax returns used for qualifying income",
      "PACE/HERO liens must be removed (subordination not acceptable)",
      "State restrictions: Florida flood zone A/V ineligible; all Texas refis ineligible; Illinois land trust vestings ineligible; GA/FL investment condos ineligible"
    ],
    derogatoryWaiting:{"BK / Foreclosure / Short Sale / DIL / NOD / Modification / Credit Counseling":"7 years from completion/discharge date to application date"},
    mortgagePaymentHistory:{"All transactions":"0x30x24 — zero lates in the most recent 24 months; minimum 24-month mortgage or rental payment history required"},
    ineligibleProducts:["ARMs","Interest only","Temp buydowns","Delayed financing","CEMA","One-time close construction","Turn-key investment properties"],
    studentLoans:"Follow Optima Jumbo Underwriting Manual",
    specialFeatures:["QM / Safe Harbor compliant","Loan amounts above conforming limits up to $2.5M","Manual underwriting (no AUS)","Second homes and investment eligible","1-2 unit properties eligible","Full appraisal always required","Escrow waiver available (flood escrow required if applicable)"] },

  { id:"pm-aus-jumbo", lenderId:"pennymac", name:"AUS Jumbo", shortName:"AUS Jumbo", agency:"Jumbo", aus:"DU or LPA", ausRequired:"DU Approve/Ineligible or LPA Accept/Ineligible (ineligible due to loan amount only); Agency High Balance requires Approve/Eligible or Accept/Eligible", updatedDate:"02/09/2026", loanTypes:["Jumbo"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home","Investment"], propertyTypes:["SFR","Condo","2-4 Unit","PUD","Rural"], ineligiblePropertyTypes:["Manufactured Home","Mobile Home","Co-op","Condotel","Timeshare","Working Farm","Leasehold","Non-Warrantable Condo","Land Trust","Hotel Condominium"], terms:["Fixed 15yr","Fixed 30yr (only term >80% LTV)","5/6 ARM (2-1-5)","7/6 ARM (5-1-5)","10/6 ARM (5-1-5)"], minFico:700, maxDti:50, dtiNote:"Max 50% DTI: fixed rate, OO, max 80% LTV, max $2M; all other scenarios max 45%; ARMs max 45%", highBalance:true, incomeLimit:null, manualUw:false, cashOutAllowed:true, armsAllowed:true, minLoanAmount:null, maxLoanAmount:3500000,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":89.99,"2-unit":84.99}, rateTerm:{"1-unit":89.99,"2-unit":84.99}, cashOut:{"1-unit":80,"2-unit":70} }, secondHome:{ purchase:{"1-unit":80}, rateTerm:{"1-unit":80}, cashOut:{"1-unit":70} }, investment:{ purchase:{"1-unit":80,"2-unit":70}, rateTerm:{"1-unit":75,"2-unit":70}, cashOut:{"1-unit":70,"2-unit":65} } },
    ltvNotes:"Min fixed loan: $1 above conforming limit; min ARM loan: $500K. Max loan: $3.5M (OO 1-unit purch/RT); $3M (OO 2-unit, second home, purch/RT); $2.5M (investment). OO 1-unit Purch/RT: 89.99% ($1.5M, 700; $2M, 720); 80% ($2.5M, 720; $3M, 740); 75% ($3.5M, 740). OO cash-out: 80% (up to $2M, 700-740); 70% ($3M, 740); max $500K cash-out. 2H Purch/RT: 80% (up to $2M, 700-720); 75% ($3M, 740). 2H cash-out: 70% (up to $2M, 720-740). Inv purch: 80% (1-unit, up to $2M, 700-740); 75% (1-unit, $2.5M, 740); inv cash-out: 70% (1-unit)/65% (2-unit). ARMs: OO and 2H only, 1-unit, max 80% LTV, max $2.5M, max 45% DTI. Temp buydowns: fixed rate only, OO purchase, max $1.5M, min 740 FICO. LTV >80%: 30yr fixed only.",
    overlays:[
      "AUS required (DU or LPA) — manual underwriting not permitted",
      "Jumbo amounts: DU Approve/Ineligible or LPA Accept/Ineligible (ineligible due to loan amount only); Agency High Balance: Approve/Eligible or Accept/Eligible",
      "QM / Safe Harbor — all loans must meet General QM requirements",
      "Min loan: $1 above conforming standard limit (fixed); $500K (ARMs)",
      "Max loan: $3.5M (OO 1-unit purchase/RT); $3M (OO 2-unit, 2H); $2.5M (investment)",
      "ARMs: OO and second home only, 1-unit only, max 80% LTV, max $2.5M, max 45% DTI, no temp buydowns; SOFR index, margin 2.75%, 5/6 ARM 2/1/5 caps, 7/6 and 10/6 ARM 5/1/5 caps, 45-day lookback, floor = margin",
      "LTV >80%: 30-year fixed rate only",
      "Temp buydowns: fixed rate only; OO purchase only; max $1.5M; min 740 FICO; seller/builder/realtor paid only; max 2% total reduction; max 2 years",
      "Max DTI 50%: fixed rate, OO, max 80% LTV, max $2M loan — all other scenarios max 45%",
      "7-year seasoning: BK, foreclosure, short sale, DIL, mortgage charge-off; modifications and forbearance: 6 months timely payments post exit",
      "Currently in forbearance: ineligible",
      "No frozen credit bureaus; AUS must be rerun with updated credit",
      "Max 10 financed properties; 7-10 financed properties require 720+ FICO (or Jumbo AUS FICO if higher)",
      "Non-occupant co-borrowers must meet Agency gift donor relationship; non-resident borrowers and foreign nationals ineligible",
      "Non-permanent resident aliens: lawful residence required; 2+ years US employment history with tax returns",
      "Condominiums: Agency warrantable only; jumbo amounts require full review with CPM (DU) or CPA (LPA); limited review ineligible for jumbo; project not eligible if CPM 'unavailable' or CPA 'ineligible'",
      "Cash-out max $500K (OO and 2H); recently listed properties limited to 70% LTV if listed within 6 months of application; no cash-out on currently listed properties",
      "VODs not acceptable; handwritten VOE/VOM/VOR ineligible; WVOE acceptable with W-2s and paystubs",
      "Capital gains income ineligible; marijuana income ineligible; crypto/virtual currency income ineligible",
      "Fannie Mae Day 1 Certainty and Freddie Mac AIM relief not applicable",
      "Property flipping: re-sale within 180 days with non-arm's length + value increase prohibited; within 180 days with price increase requires Property Valuation Group full review",
      "IPC max: 9% (LTV ≤75%); 6% (LTV >75% to 90%); 2% (investment)",
      "Gift funds: follow Agency; not on investment; no gifts of equity; no gifts from sellers",
      "Escrow required above 80% LTV (90% in CA) or per state law; flood escrow always required",
      "HPML and high-cost loans ineligible",
      "Tax transcripts required when tax returns used for qualifying income",
      "Two appraisals required: purch/RT loan amounts >$3M; all refis >$2M",
      "Property inspection waivers not eligible; unpermitted additions ineligible",
      "PACE/HERO liens must be paid off at or before closing (subordination not acceptable)",
      "State restrictions: TX 50(a)(6) refi ineligible; IL land trust vestings ineligible"
    ],
    derogatoryWaiting:{"BK / Foreclosure / Short Sale / DIL / Mortgage Charge-Off":"7 years from completion/discharge date","Modifications / Forbearance":"6 months timely consecutive payments post-modification/exit from forbearance required"},
    ineligibleProducts:["ARMs on investment","ARMs on 2+ units","3-4 unit properties","One-time close construction","Renovation programs","Low-to-moderate income programs","Delayed financing on ARMs","Delayed financing on investment (DU only)","Student loan cash-out refis (FNMA)"],
    studentLoans:"Follow applicable AUS (DU or LPA) Agency guidelines",
    specialFeatures:["AUS-driven (DU or LPA) — higher LTVs than non-AUS Jumbo (up to 89.99%)","Max loan up to $3.5M","ARMs available (5/6, 7/6, 10/6 SOFR; OO and second home, 1-unit, max 80% LTV)","Agency High Balance amounts also eligible","Temp buydowns available (OO purchase, fixed rate, max $1.5M, 740 FICO)","Max DTI 50% (fixed, OO, max 80% LTV, max $2M)","Rural properties eligible (per Agency)","Delayed financing eligible on OO and second home (per Agency, within 180 days of purchase)","Second homes and investment eligible","1-2 unit properties eligible"] },

  // ── PRMG Programs ──────────────────────────────────────────────────────────
  { id:"prmg-fnma-conforming", lenderId:"prmg", name:"Agency Fannie Mae Standard & High Balance", shortName:"PRMG FNMA Conforming", agency:"Fannie Mae", aus:"DU", ausRequired:"Approve/Eligible", updatedDate:"03/19/2026",
    loanTypes:["Conventional"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"],
    occupancy:["Owner Occupied","Second Home","Investment"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home","Rural"],
    ineligiblePropertyTypes:["Mobile Home","Co-op","Condotel","Non-Warrantable Condo","Timeshare","Geodesic Dome","Working Farm"],
    terms:["Fixed 10-30yr","5/6 ARM","7/6 ARM","10/6 ARM"],
    minFico:null, maxDti:null, dtiNote:"Per DU", highBalance:true, incomeLimit:null, manualUw:false,
    cashOutAllowed:true, armsAllowed:true, minLoanAmount:30000,
    ltv:{ ownerOccupied:{ purchase:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95}, rateTerm:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95}, cashOut:{"1-unit":80,"2-4-unit":75} }, secondHome:{ purchase:{"1-unit":90}, rateTerm:{"1-unit":90}, cashOut:{"1-unit":75} }, investment:{ purchase:{"1-unit":85,"2-4-unit":75}, rateTerm:{"1-4-unit":75}, cashOut:{"1-unit":75,"2-4-unit":70} } },
    ltvNotes:"97% LTV: 1-unit OO purchase/RT refi, standard balance, fixed rate only (FTHB or Fannie-owned loan). Enhanced NOO/SH product: 30yr fixed, 65–80% LTV, 720 FICO, >$200k loan. No-MI (LPMI) option: 600 FICO OO, 620 FICO SH/NOO.",
    overlays:["Min loan $30,000","Manual underwriting not permitted","No-MI (Lender Paid MI) option available","97% LTV limited to standard balance, fixed rate, OO (FTHB or existing Fannie-owned loan)","Enhanced NOO/SH: 30yr fixed, 65–80% LTV, ≥720 FICO, loan >$200k","ARM overlays: check program matrix","Temp buydowns: seller/lender-paid, OO/SH, fixed rate only","TX 50(a)(6): fixed rate, 1-unit OO, 80% LTV, full appraisal"],
    derogatoryWaiting:{"Chapter 7/11 BK":"4 years","Chapter 13 BK":"2 yrs discharge / 4 yrs dismissal","Multiple BK":"5 years","Foreclosure":"7 years","Short Sale / DIL":"4 years"},
    ineligibleProducts:["Barndominiums","Tiny homes","Unique/non-traditional homes"],
    specialFeatures:["DU Approve/Eligible required","Channels: Wholesale, Retail, Correspondent","No-MI (LPMI) option available","97% LTV for FTHB or Fannie-owned refi (standard balance, fixed)","Enhanced NOO/SH product available (720 FICO, 65–80% LTV, fixed 30yr, >$200k)"] },

  { id:"prmg-fhlmc-conforming", lenderId:"prmg", name:"Agency Freddie Mac Standard & Super Conforming", shortName:"PRMG FHLMC Conforming", agency:"Freddie Mac", aus:"LPA", ausRequired:"Accept/Eligible", updatedDate:"03/19/2026",
    loanTypes:["Conventional"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"],
    occupancy:["Owner Occupied","Second Home","Investment"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home","Rural"],
    ineligiblePropertyTypes:["Mobile Home","Co-op","Condotel","Non-Warrantable Condo","Timeshare","Geodesic Dome","Working Farm","On-Frame Modular"],
    terms:["Fixed 10-30yr","5/6 ARM","7/6 ARM","10/6 ARM"],
    minFico:null, maxDti:null, dtiNote:"Per LPA", highBalance:true, incomeLimit:null, manualUw:false,
    cashOutAllowed:true, armsAllowed:true, minLoanAmount:30000,
    ltv:{ ownerOccupied:{ purchase:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95}, rateTerm:{"1-unit-frm":97,"1-unit-arm":95,"2-unit":95,"3-4-unit":95}, cashOut:{"1-unit":80,"2-4-unit":75} }, secondHome:{ purchase:{"1-unit":90}, rateTerm:{"1-unit":90}, cashOut:{"1-unit":75} }, investment:{ purchase:{"1-unit":85,"2-4-unit":75}, rateTerm:{"1-4-unit":75}, cashOut:{"1-unit":75,"2-4-unit":70} } },
    ltvNotes:"97% LTV: 1-unit OO purchase/RT refi, standard balance, fixed rate. Super Conforming (HB) also eligible.",
    overlays:["Min loan $30,000","Manual underwriting not permitted","Extenuating circumstances not permitted for derogatory waiting periods","On-Frame Modular ineligible","Illinois Land Trust ineligible"],
    derogatoryWaiting:{"All derogatory events":"Per LPA approval — no defined PRMG waiting periods (extenuating circumstances not permitted)"},
    ineligibleProducts:["Illinois Land Trust","On-Frame Modular","Barndominiums","Tiny homes"],
    specialFeatures:["LPA Accept/Eligible required","Channels: Wholesale, Retail, Correspondent","Super Conforming (High Balance) eligible","No extenuating circumstances credit for derogatory waiting periods"] },

  { id:"prmg-refinow", lenderId:"prmg", name:"Fannie Mae RefiNow", shortName:"PRMG RefiNow", agency:"Fannie Mae", aus:"DU", ausRequired:"Approve/Eligible", updatedDate:"03/12/2026",
    loanTypes:["Conventional"], purposes:["Rate/Term Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home"],
    ineligiblePropertyTypes:["Mobile Home","Co-op","Condotel","Non-Warrantable Condo","Timeshare","Geodesic Dome","Working Farm"],
    terms:["Fixed 15yr","Fixed 30yr"],
    minFico:null, maxDti:65, dtiNote:"65% max", highBalance:false, incomeLimit:"100% AMI", manualUw:false,
    cashOutAllowed:false, armsAllowed:false, minLoanAmount:30000, maxLoanAmount:832750,
    priorAgencyLoanRequired:"Fannie Mae",
    ltv:{ ownerOccupied:{ purchase:{"1-unit":97}, rateTerm:{"1-unit":97}, cashOut:{} }, secondHome:{}, investment:{} },
    ltvNotes:"Max 97% LTV (95% for Manufactured Home or non-occupant co-borrower). Standard balance only.",
    overlays:["Standard balance only — high balance not permitted","ARMs not permitted","Cash-out not permitted","TX 50(a)(6) not permitted","Prior Fannie Mae loan required (verify via FNMA Loan Lookup)","Identical borrowers required — cannot add or remove borrowers","Min loan $30,000","Max loan $832,750 (standard conforming limit)","Income at or below 100% AMI required"],
    derogatoryWaiting:{"Chapter 7/11 BK":"4 years","Chapter 13 BK":"2 yrs discharge / 4 yrs dismissal","Multiple BK":"5 years","Foreclosure":"7 years","Short Sale / DIL":"4 years"},
    ineligibleProducts:["High balance loans","ARMs","Cash-out refis"],
    specialFeatures:["DU Approve/Eligible required","Prior Fannie Mae loan required","Identical borrowers required","100% AMI income limit","Rate must be reduced by at least 0.5%","No MI increase permitted"] },

  { id:"prmg-refi-possible", lenderId:"prmg", name:"Freddie Mac Refi Possible", shortName:"PRMG Refi Possible", agency:"Freddie Mac", aus:"LPA", ausRequired:"Accept/Eligible", updatedDate:"03/19/2026",
    loanTypes:["Conventional"], purposes:["Rate/Term Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home"],
    ineligiblePropertyTypes:["Mobile Home","Co-op","Condotel","Non-Warrantable Condo","Timeshare","Geodesic Dome","Working Farm","On-Frame Modular"],
    terms:["Fixed 15yr","Fixed 30yr"],
    minFico:null, maxDti:65, dtiNote:"65% max", highBalance:false, incomeLimit:"100% AMI", manualUw:false,
    cashOutAllowed:false, armsAllowed:false, minLoanAmount:30000, maxLoanAmount:832750,
    priorAgencyLoanRequired:"Freddie Mac",
    ltv:{ ownerOccupied:{ purchase:{"1-unit":97}, rateTerm:{"1-unit":97}, cashOut:{} }, secondHome:{}, investment:{} },
    ltvNotes:"Max 97% LTV (95% for Manufactured Home or non-occupant co-borrower). Standard balance only.",
    overlays:["Standard balance only — high balance not permitted","ARMs not permitted","Cash-out not permitted","Prior Freddie Mac loan required (verify via FHLMC Loan Look-Up)","Identical borrowers required — cannot add or remove borrowers","Min loan $30,000","Max loan $832,750","Income at or below 100% AMI required"],
    derogatoryWaiting:{"All derogatory events":"Per LPA approval — no defined PRMG waiting periods"},
    ineligibleProducts:["High balance loans","ARMs","Cash-out refis","On-Frame Modular"],
    specialFeatures:["LPA Accept/Eligible required","Prior Freddie Mac loan required","Identical borrowers required","100% AMI income limit","Rate must be reduced by at least 0.5%","Discount point cap: if borrower receives ≥$500 lender credit, cannot pay points > 1%"] },

  { id:"prmg-home-possible", lenderId:"prmg", name:"Freddie Mac Home Possible", shortName:"PRMG Home Possible", agency:"Freddie Mac", aus:"LPA", ausRequired:"Accept/Eligible", updatedDate:"03/19/2026",
    loanTypes:["Conventional"], purposes:["Purchase","Rate/Term Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD"],
    ineligiblePropertyTypes:["Mobile Home","Co-op","Condotel","Non-Warrantable Condo","Timeshare","Geodesic Dome","Working Farm","On-Frame Modular","Investment"],
    terms:["Fixed 15yr","Fixed 30yr"],
    minFico:620, maxDti:50, dtiNote:"50% max (45% for 3–4 unit >80% LTV)", highBalance:false, incomeLimit:"80% AMI", manualUw:false,
    cashOutAllowed:false, armsAllowed:false, minLoanAmount:30000,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":97,"2-unit":95,"3-4-unit":95}, rateTerm:{"1-unit":97,"2-unit":95,"3-4-unit":95}, cashOut:{} }, secondHome:{}, investment:{} },
    ltvNotes:"OO only. 1-unit: 97% purchase/RT refi. 2-4 unit: 95%. No cash-out. No ARMs. No high balance.",
    overlays:["OO only — no SH or NOO","Cash-out not permitted","ARMs not permitted","High balance not permitted","Min 620 FICO","Max DTI 50% (45% for 3–4 unit >80% LTV)","Income at or below 80% AMI required","Homebuyer education required when all occupying borrowers are FTHBs","Min loan $30,000","On-Frame Modular ineligible"],
    derogatoryWaiting:{"All derogatory events":"Per LPA approval — no defined PRMG waiting periods"},
    ineligibleProducts:["Cash-out refis","ARMs","High balance","Investment","Second Home","On-Frame Modular"],
    specialFeatures:["LPA Accept/Eligible required","80% AMI income limit","Reduced MI (Home Possible MI rates)","$2,500 VLIP grant for borrowers ≤50% AMI","Homebuyer education required for all-FTHB transactions","Odd loan terms allowed (e.g. 20yr, 25yr)","Channels: Wholesale, Retail, Correspondent"] },

  { id:"prmg-homeready", lenderId:"prmg", name:"Fannie Mae HomeReady", shortName:"PRMG HomeReady", agency:"Fannie Mae", aus:"DU", ausRequired:"Approve/Eligible", updatedDate:"03/12/2026",
    loanTypes:["Conventional"], purposes:["Purchase","Rate/Term Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD"],
    ineligiblePropertyTypes:["Mobile Home","Co-op","Condotel","Non-Warrantable Condo","Timeshare","Geodesic Dome","Working Farm"],
    terms:["Fixed 10yr","Fixed 15yr","Fixed 20yr","Fixed 30yr"],
    minFico:620, maxDti:50, dtiNote:"50% max", highBalance:true, incomeLimit:"80% AMI", manualUw:false,
    cashOutAllowed:false, armsAllowed:false, minLoanAmount:30000,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":97,"2-unit":95,"3-4-unit":95}, rateTerm:{"1-unit":97,"2-unit":95,"3-4-unit":95}, cashOut:{} }, secondHome:{}, investment:{} },
    ltvNotes:"OO only. 1-unit: 97% purchase/RT refi. 2-unit: 95%. 3-4 unit: 95%. High Balance: 95% 1-unit, 85% 2-unit, 75% 3-4 unit. No cash-out. No ARMs.",
    overlays:["OO only — no SH or NOO","Cash-out not permitted","ARMs not permitted","Min 620 FICO","Max DTI 50%","Income at or below 80% AMI required","Homebuyer education required: all FTHBs, or LTV >95% with FTHB, or non-traditional credit","Min loan $30,000","Non-occupying co-borrower eligible up to 95% LTV"],
    derogatoryWaiting:{"Chapter 7/11 BK":"4 years","Chapter 13 BK":"2 yrs discharge / 4 yrs dismissal","Multiple BK":"5 years","Foreclosure":"7 years","Short Sale / DIL":"4 years"},
    ineligibleProducts:["Cash-out refis","ARMs","Investment","Second Home"],
    specialFeatures:["DU Approve/Eligible required","80% AMI income limit","Reduced MI (HomeReady MI rates)","$2,500 VLIP grant for borrowers ≤50% AMI","Homebuyer education required for all-FTHB transactions or LTV >95%","Accessory unit income (ADU rental) eligible for qualifying","Non-occupying co-borrower eligible (up to 95% LTV)","Odd loan terms allowed (e.g. 20yr, 25yr)","Channels: Wholesale, Retail, Correspondent"] },

  // --- PRMG Government Programs ---
  { id:"prmg-fha", lenderId:"prmg", name:"FHA Standard & High Balance", shortName:"PRMG FHA", agency:"FHA", aus:"DU (TOTAL Scorecard)", ausRequired:"Approve/Eligible", updatedDate:"02/12/2026",
    loanTypes:["FHA"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home"],
    ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Working Farm","Mobile Home"],
    terms:["Fixed 10-30yr","5/1 ARM"],
    minFico:580, maxDti:null, dtiNote:"Per AUS; manual UW max 31%/43%", highBalance:true, incomeLimit:null, manualUw:true,
    cashOutAllowed:true, armsAllowed:true,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":96.5,"2-4-unit":96.5}, rateTerm:{"1-unit":97.75,"2-4-unit":97.75}, cashOut:{"1-unit":80,"2-4-unit":80} }, secondHome:{}, investment:{} },
    ltvNotes:"Purchase: 96.5% LTV. Rate/Term: 97.75%. Cash-out: 80%. FICO 580-619: AUS approval only, 1-2 units, no specialty products. High Balance: same LTVs — max $832,750 (1-unit, 2026).",
    mip:{ upfront:"1.75%", annual:{"30yr_lteq95":"0.50%","30yr_gt95":"0.55%","30yr_hb_lteq95":"0.70%","30yr_hb_gt95":"0.75%","15yr_lteq78":"0.15%","15yr_78to90":"0.15%","15yr_gt90":"0.40%"}, duration:"≤90% LTV: cancels after 11 yrs; >90% LTV: life of loan" },
    overlays:[
      "Min 580 FICO with DU approval (1-2 unit only); 620 recommended for specialty products",
      "UFMIP 1.75% financed into loan; annual MIP: 30yr ≤$726,200 — 0.50% (≤95% LTV) / 0.55% (>95%); >$726,200 — 0.70%/0.75%; ≤15yr — see MIP table",
      "MIP duration: ≤90% LTV cancels after 11 yrs; >90% LTV continues for life of loan",
      "Manual UW: max 31%/43% DTI; level 3 UW with supervisor review required",
      "High Balance max: $832,750 1-unit; $1,066,250 2-unit; $1,288,800 3-unit; $1,601,750 4-unit (2026)",
      "Max 4 financed properties (including subject)",
      "Non-traditional / no credit score allowed on standard balance with manual UW",
      "OO only — investment and second homes ineligible",
      "Channels: Wholesale, Retail, Correspondent (HUD Mortgagee ID required for Correspondent)"
    ],
    derogatoryWaiting:{"Chapter 7/11 BK":"2 years","Chapter 13 BK":"1 yr from start of plan (court permission required)","Foreclosure":"3 years","DIL / Short Sale":"3 years"},
    derogatoryWaitMap:{"Chapter 7/11 BK":2,"Chapter 13 BK (discharge)":1,"Chapter 13 BK (dismissal)":1,"Foreclosure":3,"Short Sale / DIL":3},
    specialFeatures:["Down payment assistance programs eligible","FHA streamline refi available (see separate program)","Good Neighbor Next Door eligible","Non-traditional credit (standard balance, manual UW)","Channels: Wholesale, Retail, Correspondent"] },

  { id:"prmg-fha-streamline", lenderId:"prmg", name:"FHA Streamline Refinance", shortName:"PRMG FHA Streamline", agency:"FHA", aus:"DU (TOTAL Scorecard)", ausRequired:"Approve/Eligible or Manual UW", updatedDate:"02/12/2026",
    loanTypes:["FHA"], purposes:["Rate/Term Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home"],
    ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Working Farm","Mobile Home"],
    terms:["Fixed 10-30yr"],
    minFico:580, maxDti:null, dtiNote:"NCQ: no income/asset docs required; CQ: qualifying per AUS", highBalance:true, incomeLimit:null, manualUw:true,
    cashOutAllowed:false, armsAllowed:false, requiresExistingLoan:"FHA",
    ltv:{ ownerOccupied:{ rateTerm:{"1-unit":null} }, secondHome:{}, investment:{} },
    ltvNotes:"NCQ: max loan = current balance + UFMIP refund offset. CQ: standard FHA LTV limits apply.",
    mip:{ upfront:"1.75% (reduced if within 3 yrs of original FHA loan via UFMIP refund credit)", annual:"Same as standard FHA MIP table" },
    overlays:[
      "Existing FHA loan required — seasoning: 6 payments made AND 210 days elapsed since first payment date",
      "NCQ (non-credit qualifying): no income or asset documentation required",
      "CQ (credit qualifying): full income/asset documentation required",
      "Net tangible benefit required: lower rate, shorter term, or ARM-to-fixed with same/lower payment",
      "No cash back — max $500 cash back at closing",
      "No appraisal on NCQ; appraisal optional on CQ",
      "PRMG does not allow extenuating circumstances for reduced seasoning requirements"
    ],
    derogatoryWaiting:{"NCQ":"No credit review required","CQ":"Derogatory must be reviewed; must meet FHA guidelines"},
    derogatoryWaitMap:{},
    specialFeatures:["NCQ: no income/asset docs required","Net tangible benefit required","Existing FHA loan: 6 payments + 210 days seasoning","MIP refund from original loan reduces new UFMIP"] },

  { id:"prmg-va", lenderId:"prmg", name:"VA Full Doc", shortName:"PRMG VA", agency:"VA", aus:"DU or LPA", ausRequired:"AUS Approval", updatedDate:"02/12/2026",
    loanTypes:["VA"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home"],
    ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Working Farm","Mobile Home"],
    terms:["Fixed 10-30yr","5/1 ARM"],
    minFico:580, maxDti:null, dtiNote:"Per AUS; DTI >41% requires 120% residual income", highBalance:true, incomeLimit:null, manualUw:true,
    cashOutAllowed:true, armsAllowed:true, requiresVeteranEligibility:true,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":100,"2-4-unit":100}, rateTerm:{"1-unit":100}, cashOut:{"1-unit":90} }, secondHome:null, investment:null },
    ltvNotes:"No down payment required — 100% LTV purchase. Cash-out Type II max 90%. VA funding fee financed (not counted for LTV). Loan >$1.5M: 45% max DTI. Loan >$2M: max 80% LTV cash-out.",
    fundingFee:{ purchase:{"first_0_4pct":"2.15%","subsequent_0_4pct":"3.30%","first_5_9pct":"1.50%","subsequent_5_9pct":"1.50%","first_10plus":"1.25%","subsequent_10plus":"1.25%"}, cashOutRefi:{"first":"2.15%","subsequent":"3.30%"} },
    overlays:[
      "Borrower must have valid Certificate of Eligibility (COE) — Active or Pending status",
      "Funding fee: purchase 0-4.99% down: 2.15% (1st use) / 3.30% (subsequent); 5-9.99%: 1.50%/1.50%; 10%+: 1.25%/1.25%; Cash-out refi: 2.15%/3.30% — may be financed",
      "No monthly MI — VA guarantee replaces mortgage insurance",
      "Residual income required per VA regional table; 120% if DTI >41%",
      "VA Escape Clause required on all purchase transactions",
      "Condos must be VA-approved; condotels and air condos ineligible",
      "Channels: Wholesale, Retail, Correspondent"
    ],
    derogatoryWaiting:{"Chapter 7/11 BK":"2 years","Foreclosure":"2 years","DIL / Short Sale":"2 years"},
    derogatoryWaitMap:{"Chapter 7/11 BK":2,"Chapter 13 BK (discharge)":1,"Chapter 13 BK (dismissal)":2,"Foreclosure":2,"Short Sale / DIL":2},
    specialFeatures:["No down payment required","No monthly mortgage insurance","VA funding fee (may be waived for disabled veterans)","VA IRRRL available (see separate program)","Channels: Wholesale, Retail, Correspondent"] },

  { id:"prmg-va-irrrl", lenderId:"prmg", name:"VA IRRRL", shortName:"PRMG VA IRRRL", agency:"VA", aus:"LPA or Manual", ausRequired:"NCQ or CQ", updatedDate:"02/12/2026",
    loanTypes:["VA"], purposes:["Rate/Term Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD","Manufactured Home"],
    ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Working Farm","Mobile Home"],
    terms:["Fixed 10-30yr"],
    minFico:580, maxDti:null, dtiNote:"NCQ: no income/asset docs; CQ: qualifying required", highBalance:true, incomeLimit:null, manualUw:true,
    cashOutAllowed:false, armsAllowed:false, requiresExistingLoan:"VA", requiresVeteranEligibility:true,
    ltv:{ ownerOccupied:{ rateTerm:{"1-unit":null} }, secondHome:{}, investment:{} },
    ltvNotes:"No LTV limit (VA does not set LTV cap for IRRRL). Loan amount = outstanding balance + closing costs + 0.50% funding fee.",
    fundingFee:{ irrrl:"0.50% flat" },
    overlays:[
      "Existing VA loan required — seasoning: 6 monthly payments made AND 210 days elapsed since first payment",
      "Net tangible benefit (NTB): fixed-to-fixed must reduce interest rate by ≥0.50%; fixed-to-ARM must reduce by ≥2.00%",
      "NCQ: no income or asset verification required (streamline)",
      "CQ: full qualifying required (when adding borrower, or if NCQ criteria not met)",
      "Funding fee: 0.50% flat (may be financed)",
      "No cash back — borrower may not receive cash proceeds",
      "Occupancy: must certify prior occupancy of subject property"
    ],
    derogatoryWaiting:{"NCQ":"No credit review required","CQ":"Must meet VA derogatory guidelines"},
    derogatoryWaitMap:{},
    specialFeatures:["NCQ: no income/asset docs required","NTB required: ≥0.50% rate reduction (fixed-to-fixed)","Funding fee 0.50% flat","Existing VA loan: 6 payments + 210 days seasoning"] },

  { id:"prmg-va-hb", lenderId:"prmg", name:"VA High Balance", shortName:"PRMG VA High Balance", agency:"VA", aus:"DU or LPA", ausRequired:"AUS Approval", updatedDate:"02/12/2026",
    loanTypes:["VA"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","2-4 Unit","PUD"],
    ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Working Farm","Mobile Home","Manufactured Home"],
    terms:["Fixed 10-30yr"],
    minFico:580, maxDti:null, dtiNote:"Per AUS; loan >$1.5M max 45% DTI", highBalance:true, incomeLimit:null, manualUw:false,
    cashOutAllowed:true, armsAllowed:false, requiresVeteranEligibility:true,
    minLoanAmount:832751, maxLoanAmount:2000000,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":100}, rateTerm:{"1-unit":100}, cashOut:{"1-unit":90} }, secondHome:null, investment:null },
    ltvNotes:"Min loan $832,751. Max loan $2,000,000. Loan >$1.5M overlay: 700 FICO required, 0x30 last 12 months, max 90% LTV purchase, max 80% LTV cash-out.",
    fundingFee:{ purchase:{"first_0_4pct":"2.15%","subsequent_0_4pct":"3.30%","first_5_9pct":"1.50%","subsequent_5_9pct":"1.50%","first_10plus":"1.25%","subsequent_10plus":"1.25%"}, cashOutRefi:{"first":"2.15%","subsequent":"3.30%"} },
    overlays:[
      "Min loan amount $832,751 — max loan $2,000,000",
      "Loan >$1.5M overlay: 700 FICO, 0x30 last 12 months, max 90% LTV purchase, max 80% LTV cash-out",
      "Borrower must have valid COE — Active or Pending status",
      "No monthly MI — VA guarantee",
      "Residual income required per VA table; 120% if DTI >41%",
      "Fixed rate only — no ARMs",
      "Manufactured Homes ineligible"
    ],
    derogatoryWaiting:{"Chapter 7/11 BK":"2 years","Foreclosure":"2 years","DIL / Short Sale":"2 years"},
    derogatoryWaitMap:{"Chapter 7/11 BK":2,"Chapter 13 BK (discharge)":1,"Chapter 13 BK (dismissal)":2,"Foreclosure":2,"Short Sale / DIL":2},
    specialFeatures:["VA jumbo — above conforming limit; no down payment required up to $2M","Funding fee same as VA standard","No monthly mortgage insurance"] },

  { id:"prmg-usda", lenderId:"prmg", name:"USDA Guaranteed (Rural Housing)", shortName:"PRMG USDA", agency:"USDA", aus:"GUS", ausRequired:"Accept/Eligible (GUS)", updatedDate:"02/12/2026",
    loanTypes:["USDA"], purposes:["Purchase","Rate/Term Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","PUD","Manufactured Home","Rural"],
    ineligiblePropertyTypes:["2-4 Unit","Co-op","Condotel","Timeshare","Working Farm","Mobile Home"],
    terms:["Fixed 30yr"],
    minFico:640, maxDti:41, dtiNote:"29/41 manual UW; GUS Accept may allow higher", highBalance:false, incomeLimit:"USDA area limit", manualUw:true,
    cashOutAllowed:false, armsAllowed:false, ruralAreaRequired:true,
    ltv:{ ownerOccupied:{ purchase:{"1-unit":100}, rateTerm:{"1-unit":100}, cashOut:{} }, secondHome:null, investment:null },
    ltvNotes:"100% LTV — no down payment required. Upfront guarantee fee (1.00%) may be financed above appraised value.",
    guaranteeFee:{ upfront:"1.00% of base loan amount", annual:"0.35% of outstanding balance" },
    overlays:[
      "Rural area required — verify property eligibility at eligibility.sc.egov.usda.gov",
      "Household income limit — ALL adult household members' income counted (not just qualifying borrower); limits are area-specific",
      "Min 640 FICO for GUS Accept; min 580 FICO for manual underwrite",
      "GUS submission required for all loans (including manual UW); first AUS run must be prior to note date",
      "Upfront guarantee fee 1.00% (may be financed); annual fee 0.35% of outstanding balance",
      "Ratios: GUS governs; manual UW max 29/41 (up to 32/44 with compensating factors per USDA handbook)",
      "1-unit properties only — 2-4 unit ineligible",
      "Fixed 30-year term only — no ARMs",
      "No cash-out refinances",
      "Non-permanent resident aliens ineligible",
      "$25 GUS technology fee assessed to borrower for all submissions on/after 1/1/2020",
      "Short sale within 3 years: requires GUS manual downgrade",
      "Channels: Wholesale, Retail, Correspondent"
    ],
    derogatoryWaiting:{"Chapter 7 BK (manual UW)":"3 years from discharge","Chapter 13 BK":"GUS: no specific seasoning; manual: 12 months of plan elapsed","Short Sale (pre-foreclosure)":"3 years (manual downgrade required if within 3 yrs)","Foreclosure":"3 years (GUS Accept may allow; manual downgrade required within 3-7 yrs)"},
    derogatoryWaitMap:{"Chapter 7/11 BK":3,"Chapter 13 BK (discharge)":1,"Chapter 13 BK (dismissal)":1,"Foreclosure":3,"Short Sale / DIL":3},
    specialFeatures:["No down payment required (100% LTV)","USDA guarantee fee: 1.00% upfront + 0.35% annual","Household income limits apply — all adults counted","Property must be in USDA-eligible rural area","GUS automated underwriting required","Fixed 30yr only","Streamlined Assist refi available"] },

  { id:"prmg-usda-streamline", lenderId:"prmg", name:"USDA Streamlined Assist", shortName:"PRMG USDA Streamlined", agency:"USDA", aus:"Manual", ausRequired:"Manual Underwrite Only", updatedDate:"02/12/2026",
    loanTypes:["USDA"], purposes:["Rate/Term Refi"],
    occupancy:["Owner Occupied"],
    propertyTypes:["SFR","Condo","PUD","Manufactured Home","Rural"],
    ineligiblePropertyTypes:["2-4 Unit","Co-op","Condotel","Timeshare","Working Farm","Mobile Home"],
    terms:["Fixed 30yr"],
    minFico:null, maxDti:null, dtiNote:"No DTI requirement — streamline, no income analysis", highBalance:false, incomeLimit:null, manualUw:true,
    cashOutAllowed:false, armsAllowed:false, requiresExistingLoan:"USDA", ruralAreaRequired:true,
    ltv:{ ownerOccupied:{ rateTerm:{"1-unit":null} }, secondHome:{}, investment:{} },
    ltvNotes:"No LTV limit. Loan amount = outstanding balance + financed guarantee fee + eligible closing costs. No cash back to borrower.",
    guaranteeFee:{ upfront:"1.00%", annual:"0.35%" },
    overlays:[
      "Existing USDA loan required — must be current; 0x30 last 12 months; 180 days of payments received",
      "Seasoning: 6 payments made AND 210 days elapsed since first payment date",
      "No income documentation required — streamline processing",
      "No appraisal required",
      "No cash back to borrower at closing",
      "Manual underwrite only — no GUS required",
      "Manufactured homes: 680 FICO required",
      "Rural area required — property must remain in USDA-eligible area"
    ],
    derogatoryWaiting:{"All events":"Current loan must be in good standing — 0x30 last 12 months required"},
    derogatoryWaitMap:{},
    specialFeatures:["No income documentation required","No appraisal required","No DTI calculation","Existing USDA loan: 6 payments + 210 days seasoning","MH requires 680 FICO"] },

  { id:"champ-activator-full-doc", lenderId:"champion", name:"Activator Full Doc", shortName:"Activator Full Doc", agency:"Non-QM", aus:"Manual", ausRequired:"Manual underwrite — no AUS", updatedDate:"03/2026", loanTypes:["Non-QM"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home"], propertyTypes:["SFR","Condo","PUD","2-4 Unit"], ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Mobile Home","Working Farm"], terms:["Fixed 30yr","5/6 ARM","7/6 ARM","10/6 ARM"], minFico:620, maxDti:50, highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:150000,
    supportedIncomeDocs:["Full Doc"],
    ltv:{ ownerOccupied:{ purchase:{"1-unit":85,"2-unit":80,"3-4-unit":75}, rateTerm:{"1-unit":85,"2-unit":80,"3-4-unit":75}, cashOut:{"1-unit":80,"2-4-unit":75} }, secondHome:{ purchase:{"1-unit":80}, rateTerm:{"1-unit":80}, cashOut:{"1-unit":75} }, investment:null },
    overlays:["Full Doc income documentation required","Manual underwrite only — no AUS","Min $150,000 loan amount"],
    specialFeatures:["Asset utilization: qualified assets ÷ 60 months"],
    partialData:true },

  { id:"champ-activator-alt-doc", lenderId:"champion", name:"Activator Alt Doc", shortName:"Activator Alt Doc", agency:"Non-QM", aus:"Manual", ausRequired:"Manual underwrite — no AUS", updatedDate:"03/2026", loanTypes:["Non-QM"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home"], propertyTypes:["SFR","Condo","PUD","2-4 Unit"], ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Mobile Home","Working Farm"], terms:["Fixed 30yr","5/6 ARM","7/6 ARM","10/6 ARM"], minFico:620, maxDti:50, highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:150000,
    supportedIncomeDocs:["Bank Statement 12 Month","Bank Statement 24 Month","Asset Depletion","P&L Only"],
    ltv:{ ownerOccupied:{ purchase:{"1-unit":85,"2-unit":80,"3-4-unit":75}, rateTerm:{"1-unit":85,"2-unit":80,"3-4-unit":75}, cashOut:{"1-unit":80,"2-4-unit":75} }, secondHome:{ purchase:{"1-unit":80}, rateTerm:{"1-unit":80}, cashOut:{"1-unit":75} }, investment:null },
    overlays:["Alt Doc: bank statements, asset depletion, or P&L — full doc not eligible","Manual underwrite only — no AUS","Min $150,000 loan amount"],
    specialFeatures:["Asset utilization: qualified assets ÷ 60 months","P&L: CPA-signed 12-month profit & loss statement required","12 or 24 month personal or business bank statements accepted"],
    partialData:true },

  { id:"champ-accelerator-full-doc", lenderId:"champion", name:"Accelerator Full Doc", shortName:"Accelerator Full Doc", agency:"Non-QM", aus:"Manual", ausRequired:"Manual underwrite — no AUS", updatedDate:"03/2026", loanTypes:["Non-QM"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Investment"], propertyTypes:["SFR","Condo","PUD","2-4 Unit"], ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Mobile Home","Working Farm"], terms:["Fixed 30yr","5/6 ARM","7/6 ARM","10/6 ARM","IO ARM"], minFico:620, maxDti:50, highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:150000,
    supportedIncomeDocs:["Full Doc"],
    ltv:{ ownerOccupied:null, secondHome:null, investment:{ purchase:{"1-unit":80,"2-unit":75,"3-4-unit":70}, rateTerm:{"1-unit":80,"2-unit":75,"3-4-unit":70}, cashOut:{"1-unit":75,"2-4-unit":70} } },
    overlays:["Full Doc income documentation required","Manual underwrite only — no AUS","Investment properties only","Min $150,000 loan amount"],
    specialFeatures:["Entity borrowers eligible (LLC, Corporation, Partnership, Layered LLC)","Asset utilization: qualified assets ÷ 60 months","Interest-only available per matrix"],
    partialData:true },

  { id:"champ-accelerator-alt-doc", lenderId:"champion", name:"Accelerator Alt Doc", shortName:"Accelerator Alt Doc", agency:"Non-QM", aus:"Manual", ausRequired:"Manual underwrite — no AUS", updatedDate:"03/2026", loanTypes:["Non-QM"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Investment"], propertyTypes:["SFR","Condo","PUD","2-4 Unit"], ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Mobile Home","Working Farm"], terms:["Fixed 30yr","5/6 ARM","7/6 ARM","10/6 ARM","IO ARM"], minFico:620, maxDti:50, highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:150000,
    supportedIncomeDocs:["Bank Statement 12 Month","Bank Statement 24 Month","Asset Depletion","P&L Only"],
    ltv:{ ownerOccupied:null, secondHome:null, investment:{ purchase:{"1-unit":80,"2-unit":75,"3-4-unit":70}, rateTerm:{"1-unit":80,"2-unit":75,"3-4-unit":70}, cashOut:{"1-unit":75,"2-4-unit":70} } },
    overlays:["Alt Doc: bank statements, asset depletion, or P&L — full doc not eligible","Manual underwrite only — no AUS","Investment properties only","Min $150,000 loan amount"],
    specialFeatures:["Entity borrowers eligible (LLC, Corporation, Partnership, Layered LLC)","Asset utilization: qualified assets ÷ 60 months","P&L: CPA-signed 12-month profit & loss statement required","Interest-only available per matrix"],
    partialData:true },

  { id:"champ-accelerator-dscr", lenderId:"champion", name:"Accelerator DSCR 1-4 Unit", shortName:"Accelerator DSCR 1-4", agency:"Non-QM", aus:"Manual", ausRequired:"Manual underwrite — no AUS", updatedDate:"03/2026", loanTypes:["DSCR"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Investment"], propertyTypes:["SFR","Condo","PUD","2-4 Unit"], ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Mobile Home","Working Farm"], terms:["Fixed 30yr","5/6 ARM","7/6 ARM","10/6 ARM","IO ARM"], minFico:620, maxDti:null, highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:150000,
    minDscr:0.75, supportedIncomeDocs:["Asset Depletion"],
    ltv:{ ownerOccupied:null, secondHome:null, investment:{ purchase:{"1-unit":80,"2-unit":75,"3-4-unit":70}, rateTerm:{"1-unit":80,"2-unit":75,"3-4-unit":70}, cashOut:{"1-unit":75,"2-4-unit":70} } },
    overlays:["DSCR ≥ 0.75 required","1-4 unit investment properties only","STR eligible: DSCR = gross rents × 0.80 ÷ starting payment","No escrow/impound required","Min $150,000 loan amount"],
    specialFeatures:["Entity borrowers eligible (LLC, Corporation, Partnership, Layered LLC)","Asset depletion as alternate qualifying method","Short-term rental (STR/Airbnb/VRBO) eligible","No impound/escrow required","Interest-only available per matrix","DSCR as low as 0.75"],
    partialData:true },

  { id:"champ-accelerator-dscr-5-8", lenderId:"champion", name:"Accelerator DSCR 5-8 Unit", shortName:"Accelerator DSCR 5-8", agency:"Non-QM", aus:"Manual", ausRequired:"Manual underwrite — no AUS", updatedDate:"03/2026", loanTypes:["DSCR"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Investment"], propertyTypes:["5-8 Unit"], ineligiblePropertyTypes:["SFR","Condo","PUD","2-4 Unit","Co-op","Condotel","Timeshare","Mobile Home","Working Farm"], terms:["Fixed 30yr","5/6 ARM","7/6 ARM","10/6 ARM"], minFico:660, maxDti:null, highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:150000,
    minDscr:1.00, ltv:null,
    overlays:["5-8 unit residential investment properties only","DSCR ≥ 1.00 required","Experienced investors only — prior real estate investment experience required","No short-term rentals","No asset depletion for DSCR qualification","Min 660 FICO","Min $150,000 loan amount"],
    specialFeatures:["Entity borrowers eligible (LLC, Corporation, Partnership, Layered LLC)"],
    partialData:true },

  
  { id:"champ-activator-prime", lenderId:"champion", name:"Activator Prime Alt Doc", shortName:"Activator Prime", agency:"Non-QM", aus:"Manual", ausRequired:"Manual underwrite — no AUS", updatedDate:"02/09/2026", loanTypes:["Non-QM"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied","Second Home"], propertyTypes:["SFR","Condo","PUD"], ineligiblePropertyTypes:["Co-op","Condotel","Non-Warrantable Condo","Timeshare","Mobile Home","Manufactured Home","Working Farm","Leasehold","Container Home"], terms:["Fixed 30yr","7/6 ARM","10/6 ARM"], minFico:620, maxDti:null, dtiNote:"Per manual underwriting — refer to matrix", highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, ioAllowed:false, prepayPenaltyAllowed:false, minLoanAmount:150000, txCashOutIneligible:true, supportedIncomeDocs:["Bank Statement 12 Month","Bank Statement 24 Month"], noIncomeRequired:false, ltv:{ ownerOccupied:{ purchase:{"1-unit":85}, rateTerm:{"1-unit":85}, cashOut:{"1-unit":80} }, secondHome:{ purchase:{"1-unit":80}, rateTerm:{"1-unit":80}, cashOut:{"1-unit":75} }, investment:null }, overlays:["Bank statements ONLY — no full doc, no P&L, no asset depletion, no 1099, no DSCR","12 or 24 month personal OR business bank statements accepted","No interest-only products","No prepayment penalty","No delayed financing","No secondary financing","No non-arm's length transactions","TX 50(a)(6) cash-out not permitted","Iowa: minimum loan amount $125,000","North Carolina: minimum loan amount $300,000","Foreign nationals ineligible","Non-Permanent Resident Aliens ineligible","ITIN borrowers ineligible","Non-occupant co-borrowers ineligible","Non-warrantable condos not permitted","Active forbearance not permitted","All collections and charge-offs must be paid in full at or prior to closing","All judgments and liens must be paid in full prior to closing","Max 3 NSFs per year; zero negative balances permitted","Declining income not permitted","Min 50% business ownership for business bank statement qualifying","Min 2-year self-employment history required","Max aggregate exposure $10M; max 10 loans per borrower","Full interior/exterior appraisal required","Escrow holdbacks not permitted","Debt monitoring required within 10 days of closing"], derogatoryWaiting:{"Active Foreclosure":"Not permitted","Short Sale In Process":"Not permitted","DIL In Process":"Not permitted","Active Forbearance":"Not permitted","All Others":"Refer to Champions Funding matrix"}, specialFeatures:["Primary residence and second home only","12 or 24 month personal or business bank statements","Manual underwriting — no AUS","7/6 ARM and 10/6 ARM eligible (no I/O)","50% minimum business ownership for business bank statement qualifying","2-year minimum self-employment history required"], partialData:false },

  { id:"champ-ally-no-ratio", lenderId:"champion", name:"Ally No Ratio", shortName:"Ally No Ratio", agency:"Non-QM", aus:"Manual", ausRequired:"Manual underwrite — no AUS", updatedDate:"03/2026", loanTypes:["Non-QM"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied"], propertyTypes:["SFR","Condo","PUD","2-4 Unit"], ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Mobile Home","Working Farm"], terms:["Fixed 30yr","7/6 ARM","10/6 ARM"], minFico:620, maxDti:null, highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:150000,
    noIncomeRequired:true, txCashOutIneligible:true,
    ineligibleStates:["AL","AK","AR","KS","LA","MA","MO","MS","NE","NH","NM","NY","ND","PA","SD","WV","WY","DC","MD","ME","NV","WA"],
    ltv:{ ownerOccupied:{ purchase:{"1-unit":80}, rateTerm:{"1-unit":80}, cashOut:{"1-unit":75} }, secondHome:null, investment:null },
    overlays:["No income or DTI calculation — CDFI/ATR-exempt program","No entity borrowers (LLC, Corp, S-Corp, Partnership)","No ITIN, Non-Permanent Resident, or Foreign National borrowers","TX 50(a)(6) cash-out not permitted","No prepayment penalty","Ineligible states: AL, AK, AR, KS, LA, MA, MO, MS, NE, NH, NM, NY, ND, PA, SD, WV, WY + DC, MD, ME, NV, WA","Min $150,000 loan amount"],
    derogatoryWaitMap:{"Chapter 7/11 BK":4,"Chapter 13 BK (discharge)":4,"Chapter 13 BK (dismissal)":4,"Foreclosure":7,"Short Sale / DIL":4,"Multiple BK":4},
    specialFeatures:["CDFI-designated lender — no income or DTI required (ATR-exempt)","No escrow/impound required"],
    partialData:true },

  { id:"champ-super-jumbo", lenderId:"champion", name:"Super Jumbo", shortName:"Super Jumbo", agency:"Jumbo", aus:"Manual", ausRequired:"Manual underwrite — no AUS", updatedDate:"03/2026", loanTypes:["Jumbo"], purposes:["Purchase","Rate/Term Refi","Cash-Out Refi"], occupancy:["Owner Occupied"], propertyTypes:["SFR","Condo","PUD"], ineligiblePropertyTypes:["Co-op","Condotel","Timeshare","Mobile Home","Working Farm","2-4 Unit","Manufactured Home"], terms:["Fixed 30yr","5/6 ARM","7/6 ARM","10/6 ARM"], minFico:720, maxDti:38, highBalance:false, incomeLimit:null, manualUw:true, cashOutAllowed:true, armsAllowed:true, minLoanAmount:3000000, cashOutMaxAmount:1500000,
    supportedIncomeDocs:["Full Doc"],
    ltv:{ ownerOccupied:{ purchase:{"1-unit":80}, rateTerm:{"1-unit":80}, cashOut:{"1-unit":70} }, secondHome:null, investment:null },
    overlays:["Minimum loan amount $3,000,000","Maximum cash-out proceeds $1,500,000","Maximum DTI 38%","Primary residence only","All credit events must be >48 months (4-year waiting period for all derogatory types)","Reserves: $3M–$4M: 12 months PITIA; $4M–$5M: 18 months PITIA","Asset utilization: qualified assets ÷ 84 months (not 60)","Min 720 FICO"],
    derogatoryWaitMap:{"Chapter 7/11 BK":4,"Chapter 13 BK (discharge)":4,"Chapter 13 BK (dismissal)":4,"Foreclosure":4,"Short Sale / DIL":4,"Multiple BK":4},
    specialFeatures:["Asset utilization: qualified assets ÷ 84 months","Reserves scale with loan size ($3M–4M: 12mo PITIA; $4M–5M: 18mo PITIA)"],
    partialData:true },
];

function evaluateScenario(scenario, programs) {
  return programs.map((program) => {
    const fails=[], warnings=[], passes=[];
    const { loanType, purpose, occupancy, propertyType, units, fico, ltv, dti,
      isHighBalance, armRequested, incomeLimitAmi, isManufactured, isMhAdvantage,
      hasForbearance, hasDerogatory, derogatoryType, derogatoryYearsAgo,
      state, priorFannieLoan, wantsToAddBorrower, isSelfEmployed,
      dscrRatio, incomeDocType, interestOnly, prepayPenaltyOk, isForeignNational,
      vestingType, adus, loanAmount, condoWarrantability, deedRestriction } = scenario;

    if (loanType && program.loanTypes?.length) {
      if (!program.loanTypes.includes(loanType)) fails.push(`Loan type "${loanType}" not offered — program offers: ${program.loanTypes.join(", ")}`);
      else passes.push(`${loanType} loans eligible`);
    }
    if (purpose && program.purposes?.length) {
      if (!program.purposes.some(p=>p.toLowerCase().includes(purpose.toLowerCase())))
        fails.push(`"${purpose}" not permitted — allows: ${program.purposes.join(", ")}`);
    }
    if (purpose==="Cash-Out Refi" && program.cashOutAllowed===false)
      fails.push("Cash-out refinances not permitted for this program");
    if (occupancy && program.occupancy?.length) {
      if (!program.occupancy.includes(occupancy)) fails.push(`Occupancy "${occupancy}" not eligible — allows: ${program.occupancy.join(", ")}`);
      else passes.push(`${occupancy} occupancy eligible`);
    }
    if (propertyType && (program.ineligiblePropertyTypes||[]).some(t=>t.toLowerCase()===propertyType.toLowerCase()))
      fails.push(`Property type "${propertyType}" is explicitly ineligible`);
    if (fico && program.minFico) {
      if (fico<program.minFico) fails.push(`FICO ${fico} below minimum ${program.minFico}`);
      else {
        passes.push(`FICO ${fico} meets minimum ${program.minFico}`);
        if (fico<680&&program.lenderId==="pennymac") warnings.push("FICO below 680 — escrow required per PennyMac overlay");
      }
    }
    if (dti && program.maxDti) {
      if (dti>program.maxDti) fails.push(`DTI ${dti}% exceeds maximum ${program.maxDti}%`);
      else passes.push(`DTI ${dti}% within ${program.maxDti}% cap`);
    }
    if (ltv && program.ltv) {
      const occKey = occupancy==="Owner Occupied"?"ownerOccupied":occupancy==="Second Home"?"secondHome":"investment";
      const occLtv = program.ltv[occKey];
      if (occLtv==="Not Eligible") { fails.push(`${occupancy} not eligible for this program`); }
      else if (occLtv) {
        const pKey = purpose==="Purchase"?"purchase":purpose==="Rate/Term Refi"?"rateTerm":"cashOut";
        const ltvMap = occLtv[pKey];
        if (ltvMap==="Not Eligible") { fails.push(`${purpose} not eligible for this occupancy`); }
        else if (ltvMap && typeof ltvMap==="object") {
          let uk="1-unit";
          if (units==="2") uk="2-unit";
          if (units==="3"||units==="4") uk="3-4-unit";
          if (isManufactured&&isMhAdvantage&&ltvMap["1-unit-mh-advantage"]) uk="1-unit-mh-advantage";
          else if (isManufactured&&ltvMap["1-unit-standard"]) uk="1-unit-standard";
          else if (armRequested&&ltvMap["1-unit-arm"]) uk="1-unit-arm";
          else if (!armRequested&&ltvMap["1-unit-frm"]) uk="1-unit-frm";
          let maxLtv=ltvMap[uk]||ltvMap["1-unit"]||ltvMap["1-4-unit"]||null;
          if (maxLtv) {
            if (isHighBalance) {
              if (units==="2") maxLtv=Math.min(maxLtv,85);
              if (units==="3"||units==="4") maxLtv=Math.min(maxLtv,program.agency==="Freddie Mac"?80:75);
            }
            if (ltv>maxLtv) fails.push(`LTV ${ltv}% exceeds maximum ${maxLtv}% for this scenario`);
            else passes.push(`LTV ${ltv}% within ${maxLtv}% maximum`);
          }
        }
      }
    }
    if (isHighBalance&&program.highBalance===false) fails.push("High balance loans not eligible");
    if (armRequested&&program.armsAllowed===false) fails.push("ARM loans not eligible — fixed rate only");
    else if (armRequested) passes.push("ARM loans permitted");
    if (program.incomeLimit==="80% AMI") {
      if (incomeLimitAmi!==""&&incomeLimitAmi!==undefined&&parseFloat(incomeLimitAmi)>80)
        fails.push(`Income at ${incomeLimitAmi}% AMI exceeds 80% AMI limit`);
      else if (incomeLimitAmi===""||incomeLimitAmi===undefined)
        warnings.push("Program has 80% AMI income limit — verify borrower eligibility");
      else passes.push("Income within 80% AMI limit");
    }
    if (program.incomeLimit==="100% AMI") {
      if (incomeLimitAmi!==""&&incomeLimitAmi!==undefined&&parseFloat(incomeLimitAmi)>100)
        fails.push("Income exceeds 100% AMI limit for RefiNow");
      else warnings.push("RefiNow requires income at or below 100% AMI");
    }
    if (program.incomeLimit==="USDA area limit") {
      warnings.push("USDA household income limit: ALL adult household members' income counted — verify area-specific limit at eligibility.sc.egov.usda.gov");
    }
    if (program.priorAgencyLoanRequired || program.id==="pm-refinow") {
      const agencyName = program.priorAgencyLoanRequired || "Fannie Mae";
      if (!priorFannieLoan) warnings.push(`${program.shortName||program.name} requires prior loan owned by ${agencyName} — verify via loan lookup tool`);
      if (wantsToAddBorrower) fails.push(`${program.shortName||program.name} does not allow adding borrowers`);
    }
    if (hasForbearance) {
      if (program.lenderId==="pennymac") fails.push("Active forbearance — loan ineligible per PennyMac overlay");
      else warnings.push("Active forbearance — verify eligibility with lender; may require documentation of payment history and plan exit");
    }
    if (program.requiresVeteranEligibility) warnings.push("VA loan requires valid Certificate of Eligibility (COE) — confirm veteran/military service eligibility");
    if (program.ruralAreaRequired) warnings.push("USDA requires property in a USDA-eligible rural area — verify at eligibility.sc.egov.usda.gov");
    if (program.requiresExistingLoan) warnings.push(`${program.requiresExistingLoan} streamline: existing ${program.requiresExistingLoan} loan required — must meet seasoning requirements`);
    if (hasDerogatory&&derogatoryType&&derogatoryYearsAgo!=="") {
      if (program.agency==="Freddie Mac") {
        warnings.push("Freddie Mac: no defined waiting periods — derogatory must appear on credit report for LPA Accept");
      } else if (program.derogatoryWaitMap&&Object.keys(program.derogatoryWaitMap).length===0) {
        // streamline programs — no standard derogatory waiting period check
      } else {
        const defaultWm={"Chapter 7/11 BK":4,"Chapter 13 BK (discharge)":2,"Chapter 13 BK (dismissal)":4,"Foreclosure":7,"Short Sale / DIL":4,"Multiple BK":5};
        const wm=(program.derogatoryWaitMap&&Object.keys(program.derogatoryWaitMap).length>0)?program.derogatoryWaitMap:defaultWm;
        const req=wm[derogatoryType];
        if (req&&parseFloat(derogatoryYearsAgo)<req) fails.push(`${derogatoryType} waiting period not met — requires ${req} yrs, only ${derogatoryYearsAgo} elapsed`);
        else if (req) passes.push(`${derogatoryType} waiting period met`);
      }
    }
    if (state==="TX"&&purpose==="Cash-Out Refi") {
      if (program.priorAgencyLoanRequired || program.id==="pm-refinow" || program.txCashOutIneligible) fails.push(`TX 50(a)(6) cash-out not permitted by ${program.shortName||program.name}`);
      else warnings.push("TX 50(a)(6): fixed rate only, 1-unit OO, max 80% LTV, full appraisal required");
    }
    if (state && program.ineligibleStates && program.ineligibleStates.includes(state)) {
      fails.push(`State ${state} is not eligible for this program`);
    }
    if (loanAmount) {
      const minLoan = program.minLoanAmount || (["Fannie Mae","Freddie Mac","FHA","VA","USDA"].includes(program.agency) ? 75000 : null);
      if (minLoan && loanAmount < minLoan) fails.push(`Loan amount $${loanAmount.toLocaleString()} below program minimum $${minLoan.toLocaleString()}`);
      else if (minLoan) passes.push(`Loan amount meets $${minLoan.toLocaleString()} minimum`);
      if (program.maxLoanAmount && loanAmount > program.maxLoanAmount) fails.push(`Loan amount $${loanAmount.toLocaleString()} exceeds program maximum $${program.maxLoanAmount.toLocaleString()}`);
    }
    if (program.cashOutMaxAmount && purpose==="Cash-Out Refi") warnings.push(`Cash-out proceeds capped at $${program.cashOutMaxAmount.toLocaleString()} — verify actual cash-out amount meets this limit`);
    if (vestingType && vestingType !== "Individual" && vestingType !== "Trust") {
      const entityAllowed = (program.specialFeatures||[]).some(f=>f.toLowerCase().includes("entity borrower"));
      if (!entityAllowed) fails.push(`${vestingType} vesting not eligible — program requires individual or trust title`);
      else passes.push(`${vestingType} entity vesting permitted`);
    } else if (vestingType === "Individual") {
      passes.push("Individual vesting eligible");
    } else if (vestingType === "Trust") {
      passes.push("Trust vesting eligible");
    }
    if (adus && adus !== "None" && adus !== "") {
      if ((program.ineligiblePropertyTypes||[]).some(t=>t.toLowerCase().includes("adu"))) fails.push(`${adus} not permitted by this program`);
    }
    if (condoWarrantability==="Non-warrantable") {
      if (["Fannie Mae","Freddie Mac"].includes(program.agency)) fails.push("Non-warrantable condos require non-agency or portfolio financing — Fannie/Freddie ineligible");
      else if ((program.ineligiblePropertyTypes||[]).some(t=>t.toLowerCase().includes("non-warrantable"))) fails.push("Non-warrantable condos explicitly ineligible for this program");
      else if ((program.specialFeatures||program.overlays||[]).some(f=>f.toLowerCase().includes("non-warrantable"))) passes.push("Non-warrantable condos permitted (see program notes for LTV limits)");
    } else if (condoWarrantability==="Condotel") {
      if ((program.ineligiblePropertyTypes||[]).some(t=>t.toLowerCase().includes("condotel"))) fails.push("Condotel is explicitly ineligible for this program");
    }
    if (deedRestriction && deedRestriction !== "None" && deedRestriction !== "") {
      if (["FHA","VA"].includes(program.agency)) warnings.push(`Deed restriction (${deedRestriction}) — verify property meets agency requirements`);
      else if (deedRestriction==="Affordability designation") warnings.push("Affordability designation — verify lender approval and resale restriction requirements");
      else warnings.push(`Deed restriction (${deedRestriction}) — confirm acceptability with program guidelines`);
    }
    if (isForeignNational) fails.push("Foreign national borrowers are ineligible for all programs");
    if (incomeDocType) {
      if (program.noIncomeRequired) {
        passes.push("No income documentation required (CDFI/ATR-exempt program)");
      } else if (program.supportedIncomeDocs) {
        if (incomeDocType==="No Income (DSCR)") {
          if (program.minDscr!==undefined) passes.push("No income / DSCR qualifying supported");
          else fails.push(`"${incomeDocType}" only available for DSCR programs — this program requires income documentation`);
        } else if (program.supportedIncomeDocs.includes(incomeDocType)) {
          passes.push(`${incomeDocType} documentation accepted`);
          if (["Bank Statement 12 Month","Bank Statement 24 Month"].includes(incomeDocType)&&!isSelfEmployed)
            warnings.push("Bank statement income is primarily for self-employed borrowers — confirm qualification method with underwriter");
        } else {
          fails.push(`"${incomeDocType}" not supported — program accepts: ${program.supportedIncomeDocs.join(", ")}`);
        }
      } else {
        const altDocIds = ["pm-nonqm-aminus","pm-nonqm-a","pm-nonqm-aplus"];
        const assetDepletionIds = ["pm-nonqm-a","pm-nonqm-aplus"];
        if (incomeDocType==="No Income (DSCR)") {
          if (program.minDscr===undefined&&program.id!=="pm-dscr") fails.push(`"${incomeDocType}" only available for DSCR programs — this program requires income documentation`);
          else passes.push("No income / DSCR qualifying supported");
        } else if (incomeDocType==="Asset Depletion") {
          if (!assetDepletionIds.includes(program.id)) {
            fails.push("Asset depletion income not supported — available for Non-QM A and A+ only");
          } else {
            passes.push("Asset depletion income eligible");
            if (purpose==="Cash-Out Refi") fails.push("Asset depletion: cash-out refinances not eligible");
            if (occupancy&&occupancy!=="Owner Occupied") fails.push("Asset depletion: owner-occupied primary residence only");
            if (fico&&fico<700) fails.push(`Asset depletion: min 700 FICO required (scenario: ${fico})`);
            if (ltv&&ltv>85) warnings.push("Asset depletion: max 85% LTV — scenario LTV may exceed eligibility");
          }
        } else if (["Bank Statement 12 Month","Bank Statement 24 Month"].includes(incomeDocType)) {
          if (!altDocIds.includes(program.id)) fails.push(`"${incomeDocType}" not supported — bank statement doc only available for Non-QM programs`);
          else {
            passes.push(`${incomeDocType} documentation accepted`);
            if (!isSelfEmployed) warnings.push("Bank statement income is primarily for self-employed borrowers — confirm qualification method with underwriter");
          }
        } else if (incomeDocType==="1099 Only") {
          if (!altDocIds.includes(program.id)) fails.push(`"1099 Only" not supported — alt doc only available for Non-QM programs`);
          else passes.push("1099 Only documentation accepted");
        } else if (incomeDocType==="P&L Only") {
          fails.push("P&L Only not supported by any current program — consider bank statement or full doc");
        } else if (incomeDocType==="Full Doc") {
          passes.push("Full income documentation accepted");
        }
      }
    }
    if (dscrRatio && program.minDscr!==undefined) {
      if (dscrRatio==="no-ratio") {
        const noRatioOk = (program.specialFeatures||[]).some(f=>f.toLowerCase().includes("no ratio"));
        if (!noRatioOk) fails.push("No Ratio DSCR not available for this program");
        else {
          passes.push("No Ratio DSCR option available");
          if (interestOnly) fails.push("Interest-only not eligible with the No Ratio DSCR option");
        }
      } else {
        const ratio=parseFloat(dscrRatio);
        if (ratio<program.minDscr) fails.push(`DSCR ${dscrRatio} below program minimum ${program.minDscr}`);
        else passes.push(`DSCR ≥ ${dscrRatio} meets program minimum ${program.minDscr}`);
      }
    }
    if (interestOnly) {
      const hasIoTerms = (program.terms||[]).some(t=>t.includes("IO"));
      if (!hasIoTerms) {
        fails.push("Interest-only not available — program does not offer IO loan products");
      } else {
        const ioRules = program.ioRules;
        if (!ioRules) {
          passes.push("Interest-only products available");
        } else {
          if (fico&&fico<ioRules.minFico) fails.push(`Interest-only requires min ${ioRules.minFico} FICO (scenario: ${fico})`);
          else if (ltv&&ltv>ioRules.maxLtv) fails.push(`Interest-only max LTV is ${ioRules.maxLtv}% (scenario: ${ltv}%)`);
          else passes.push(`Interest-only available (min ${ioRules.minFico} FICO, max ${ioRules.maxLtv}% LTV)`);
          if (ioRules.notes) warnings.push(`IO note: ${ioRules.notes}`);
        }
      }
    }
    if (prepayPenaltyOk) {
      const hasPrepay = (program.specialFeatures||[]).some(f=>f.toLowerCase().includes("prepayment penalty available"));
      if (!hasPrepay) {
        warnings.push("Prepayment penalties are not available / not applicable for this program");
      } else if (state&&(program.prepayIneligibleStates||[]).includes(state)) {
        fails.push(`Prepayment penalty not permitted in ${state} for this program`);
      } else if (state&&(program.prepayRestrictedStates||[]).includes(state)) {
        warnings.push(`${state}: prepayment penalty has additional state-level restrictions — verify with guidelines`);
        passes.push("Prepayment penalty option available (with state restrictions)");
      } else {
        passes.push("Prepayment penalty option available");
        if (occupancy==="Investment"&&purpose==="Cash-Out Refi"&&["pm-nonqm-aminus","pm-nonqm-a","pm-nonqm-aplus"].includes(program.id)) {
          warnings.push("Prepayment penalty: not permitted on investment cash-out for personal use — confirm business purpose");
        }
      }
    }
    if (program.partialData) warnings.push("⚠ Full guidelines not yet uploaded — partial data only");
    return { program, matched:fails.length===0, fails, warnings, passes };
  });
}

const LOAN_TYPES=["Conventional","VA","FHA","USDA","Jumbo","Non-QM","DSCR"];
const PURPOSES=["Purchase","Rate/Term Refi","Cash-Out Refi"];
const OCCUPANCIES=["Owner Occupied","Second Home","Investment"];
const PROPERTY_TYPES=["SFR","Condo","2-4 Unit","5-8 Unit","PUD","Manufactured Home","Rural","Condotel","Co-op","Mobile Home"];
const STATES=["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const DEROG_TYPES=["Chapter 7/11 BK","Chapter 13 BK (discharge)","Chapter 13 BK (dismissal)","Foreclosure","Short Sale / DIL","Multiple BK"];
const INCOME_DOC_TYPES=["Full Doc","Bank Statement 12 Month","Bank Statement 24 Month","1099 Only","P&L Only","Asset Depletion","No Income (DSCR)"];
const DSCR_RATIO_OPTIONS=[{v:"",l:"Not specified"},{v:"no-ratio",l:"No Ratio"},{v:"0.75",l:"≥ 0.75"},{v:"0.80",l:"≥ 0.80"},{v:"0.90",l:"≥ 0.90"},{v:"1.00",l:"≥ 1.00"},{v:"1.10",l:"≥ 1.10"},{v:"1.20",l:"≥ 1.20"},{v:"1.25",l:"≥ 1.25"}];
const VESTING_TYPES=["Individual","Trust","LLC","Corporation","Partnership","Layered LLC"];
const ADU_OPTIONS=["None","1 ADU","2 ADUs","3+ ADUs"];
const CONDO_WARRANTABILITY=["Warrantable","Non-warrantable","Condotel"];
const DEED_RESTRICTION_TYPES=["None","Owner occupancy required","Resale restrictions","Income restrictions","Affordability designation"];
const EMPTY={loanType:"",purpose:"",occupancy:"",propertyType:"",units:"1",fico:"",ltv:"",dti:"",loanAmount:"",isHighBalance:false,isFirstTimeHomeBuyer:false,armRequested:false,isSelfEmployed:false,incomeLimitAmi:"",isManufactured:false,isMhAdvantage:false,hasForbearance:false,hasDerogatory:false,derogatoryType:"",derogatoryYearsAgo:"",state:"",priorFannieLoan:false,wantsToAddBorrower:false,incomeDocType:"",dscrRatio:"",interestOnly:false,prepayPenaltyOk:false,isForeignNational:false,vestingType:"",adus:"",condoWarrantability:"",deedRestriction:""};

const inp = (label,key,scenario,set,type="text",ph="") => (
  <div style={{display:"flex",flexDirection:"column",gap:4}}>
    <label style={{fontSize:11,color:"#666",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</label>
    <input type={type} value={scenario[key]} onChange={e=>set(key,e.target.value)} placeholder={ph}
      style={{fontSize:14,padding:"8px 10px",borderRadius:8,border:"0.5px solid #d0cec6",background:"#fff",width:"100%",boxSizing:"border-box"}}/>
  </div>
);
const sel = (label,key,options,scenario,set,ph="Any") => (
  <div style={{display:"flex",flexDirection:"column",gap:4}}>
    <label style={{fontSize:11,color:"#666",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</label>
    <select value={scenario[key]} onChange={e=>set(key,e.target.value)}
      style={{fontSize:14,padding:"8px 10px",borderRadius:8,border:"0.5px solid #d0cec6",background:"#fff",width:"100%",boxSizing:"border-box"}}>
      <option value="">{ph}</option>
      {options.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);
const chk = (label,key,scenario,set) => (
  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#444",cursor:"pointer"}}>
    <input type="checkbox" checked={scenario[key]} onChange={e=>set(key,e.target.checked)}/>{label}
  </label>
);

function matchesLoanTypeFilter(program, filter) {
  if (filter==="All Types") return true;
  if (filter==="Non-QM") return program.loanTypes?.some(t=>t==="Non-QM"||t==="DSCR");
  return program.loanTypes?.includes(filter);
}

function formatProgramDetailed(p, lenderName) {
  const lines=[
    `## ${lenderName} — ${p.name} (${p.agency})`,
    `Loan Types: ${p.loanTypes?.join(", ")} | Purposes: ${p.purposes?.join(", ")}`,
    `Occupancy: ${p.occupancy?.join(", ")} | Terms: ${p.terms?.join(", ")||"—"}`,
    `Min FICO: ${p.minFico??"-"} | Max DTI: ${p.maxDti?p.maxDti+"%":p.dtiNote||"Per AUS"}`,
    `High Balance: ${p.highBalance===false?"No":"Yes"} | ARMs: ${p.armsAllowed===false?"No":"Yes"} | Cash-out: ${p.cashOutAllowed===false?"No":"Yes"} | Manual UW: ${p.manualUw?"Yes":"No"}`,
  ];
  if (p.incomeLimit) lines.push(`Income Limit: ${p.incomeLimit}`);
  if (p.ltvNotes) lines.push(`LTV: ${p.ltvNotes}`);
  if (p.minLoanAmount) lines.push(`Min Loan: $${p.minLoanAmount.toLocaleString()}`);
  if (p.maxLoanAmount) lines.push(`Max Loan: $${p.maxLoanAmount.toLocaleString()}`);
  if (p.minDscr!==undefined) lines.push(`Min DSCR: ${p.minDscr}`);
  if (p.mip) lines.push(`MIP: UFMIP ${p.mip.upfront}; Annual (30yr ≤$726k): ≤95% LTV → ${p.mip.annual["30yr_lteq95"]}, >95% → ${p.mip.annual["30yr_gt95"]}; Duration: ${p.mip.duration}`);
  if (p.fundingFee) {
    const ff=p.fundingFee;
    if (ff.irrrl) lines.push(`VA Funding Fee (IRRRL): ${ff.irrrl}`);
    else if (ff.purchase) lines.push(`VA Funding Fee: 0-4.99% down ${ff.purchase.first_0_4pct}/${ff.purchase.subsequent_0_4pct} (1st/sub); 5-9.99% ${ff.purchase.first_5_9pct}; 10%+ ${ff.purchase.first_10plus}; cash-out ${ff.cashOutRefi?.first}/${ff.cashOutRefi?.subsequent}`);
  }
  if (p.guaranteeFee) lines.push(`Guarantee Fee: ${p.guaranteeFee.upfront} upfront + ${p.guaranteeFee.annual} annual`);
  if (p.ioRules) lines.push(`IO Rules: min FICO ${p.ioRules.minFico}, max LTV ${p.ioRules.maxLtv}%${p.ioRules.notes?"; "+p.ioRules.notes:""}`);
  if (p.prepayIneligibleStates?.length) lines.push(`Prepay ineligible: ${p.prepayIneligibleStates.join(", ")}`);
  if (p.prepayRestrictedStates?.length) lines.push(`Prepay restricted: ${p.prepayRestrictedStates.join(", ")}`);
  if (p.derogatoryWaiting) lines.push(`Derogatory Waiting: ${Object.entries(p.derogatoryWaiting).map(([k,v])=>`${k}: ${v}`).join("; ")}`);
  if (p.overlays?.length) lines.push(`Overlays:\n${p.overlays.map(o=>"  - "+o).join("\n")}`);
  if (p.specialFeatures?.length) lines.push(`Special Features: ${p.specialFeatures.join("; ")}`);
  return lines.join("\n");
}

function formatProgramSummary(p, lenderName) {
  const parts=[`${lenderName} — ${p.name} (${p.agency})`];
  const attrs=[];
  if (p.minFico) attrs.push(`min FICO ${p.minFico}`);
  if (p.maxDti) attrs.push(`max DTI ${p.maxDti}%`);
  if (p.highBalance===false) attrs.push("no HB");
  if (p.armsAllowed===false) attrs.push("fixed only");
  if (p.cashOutAllowed===false) attrs.push("no cash-out");
  if (p.incomeLimit) attrs.push(p.incomeLimit);
  if (p.minDscr!==undefined) attrs.push(`min DSCR ${p.minDscr}`);
  if (p.minLoanAmount) attrs.push(`min $${(p.minLoanAmount/1000).toFixed(0)}k`);
  if (p.maxLoanAmount) attrs.push(`max $${(p.maxLoanAmount/1000000).toFixed(1)}M`);
  if (p.ruralAreaRequired) attrs.push("rural only");
  if (p.requiresVeteranEligibility) attrs.push("COE required");
  if (attrs.length) parts.push(`  Key: ${attrs.join(", ")}`);
  if (p.purposes?.length) parts.push(`  Purposes: ${p.purposes.join(", ")}`);
  return parts.join("\n");
}

function formatProgramContext(programs, loanTypeFilter) {
  const lenderNames={};
  SEED_LENDERS.forEach(l=>lenderNames[l.id]=l.name);

  if (loanTypeFilter==="All Types") {
    // Summarized view grouped by agency to keep tokens manageable
    const byAgency={};
    programs.forEach(p=>{
      const ag=p.agency||"Other";
      if (!byAgency[ag]) byAgency[ag]=[];
      byAgency[ag].push(p);
    });
    const sections=Object.entries(byAgency).map(([agency,progs])=>{
      const header=`### ${agency} Programs (${progs.length})`;
      const rows=progs.map(p=>formatProgramSummary(p,lenderNames[p.lenderId]||p.lenderId));
      return [header,...rows].join("\n");
    });
    return sections.join("\n\n");
  }

  // Specific loan type: full detail for matching programs only
  const filtered=programs.filter(p=>matchesLoanTypeFilter(p,loanTypeFilter));
  if (!filtered.length) return `No ${loanTypeFilter} programs currently loaded.`;
  return filtered.map(p=>formatProgramDetailed(p,lenderNames[p.lenderId]||p.lenderId)).join("\n\n---\n\n");
}

export default function App() {
  const [view,setView]=useState("search");
  const [scenario,setScenario]=useState(EMPTY);
  const [results,setResults]=useState(null);
  const [filter,setFilter]=useState("all");
  const [expandedId,setExpandedId]=useState(null);
  const [customPrograms,setCustomPrograms]=useState(()=>{try{const s=localStorage.getItem("ls_programs");return s?JSON.parse(s):[]}catch{return[]}});
  const [importJson,setImportJson]=useState("");
  const [importError,setImportError]=useState("");
  const [pendingConflict,setPendingConflict]=useState(null);
  const [nlText,setNlText]=useState("");
  const [isParsing,setIsParsing]=useState(false);
  const [parseError,setParseError]=useState("");
  const [lenderFilter,setLenderFilter]=useState([]);
  const [lenderFilterOpen,setLenderFilterOpen]=useState(false);
  const [qaLoanType,setQaLoanType]=useState("All Types");
  const [qaQuestion,setQaQuestion]=useState("");
  const [qaAnswer,setQaAnswer]=useState(null);
  const [qaIsLoading,setQaIsLoading]=useState(false);
  const [qaError,setQaError]=useState("");
  const [qaHistory,setQaHistory]=useState(()=>{try{const s=localStorage.getItem("ls_qa_history");return s?JSON.parse(s):[]}catch{return[]}});
  const allPrograms=[...SEED_PROGRAMS,...customPrograms];

  const set=(k,v)=>setScenario(p=>({...p,[k]:v}));

  function handleImport() {
    setImportError("");
    let program;
    try {
      const parsed=JSON.parse(importJson.trim());
      program=Array.isArray(parsed)?parsed[0]:parsed;
      if(!program||typeof program!=="object"||!program.name||!program.lenderId) throw new Error();
    } catch {
      setImportError("Invalid JSON — must be an object with at least name and lenderId fields.");
      return;
    }
    const existing=allPrograms.find(
      p=>p.name.toLowerCase()===program.name.toLowerCase()&&p.lenderId===program.lenderId
    );
    if(existing) {
      const isCustom=customPrograms.some(c=>c.id===existing.id);
      setPendingConflict({incoming:program,existing,isCustom});
    } else {
      commitProgram(program,null);
    }
  }

  function commitProgram(program,replaceId) {
    const entry={...program,id:replaceId||program.id||`custom-${Date.now()}`};
    setCustomPrograms(prev=>{
      const filtered=replaceId?prev.filter(p=>p.id!==replaceId):prev;
      const updated=[...filtered,entry];
      localStorage.setItem("ls_programs",JSON.stringify(updated));
      return updated;
    });
    setImportJson("");
    setImportError("");
    setPendingConflict(null);
  }

  async function parseScenario() {
    const key=localStorage.getItem("ls_claude_api_key");
    if (!key) { setParseError("Add your Claude API key in the Admin panel first."); return; }
    setIsParsing(true); setParseError("");
    try {
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({
          model:"claude-haiku-4-5-20251001",
          max_tokens:512,
          system:"You are a strict mortgage scenario parser. Your only job is to extract values that are EXPLICITLY stated in the broker's description. Return ONLY a JSON object with these fields: loanType, purpose, occupancy, propertyType, units, fico, ltv, dti, loanAmount, isHighBalance, armRequested, isSelfEmployed, incomeLimitAmi, isManufactured, isMhAdvantage, hasForbearance, hasDerogatory, derogatoryType, derogatoryYearsAgo, state, priorFannieLoan, dscrRatio, incomeDocType, interestOnly, prepaymentPenaltyOk, foreignNational, vestingType, adus, condoWarrantability, deedRestriction. CRITICAL RULES: (1) If a field is not explicitly mentioned in the description, return null — never guess, infer, or assume a typical or default value. (2) Do not infer FICO from loan type (e.g. FHA does not imply any FICO). (3) Do not infer occupancy from purpose. (4) Do not infer income doc type from borrower type. (5) Only set boolean flags to true if the description explicitly mentions that condition. For loanType use: Conventional, FHA, VA, USDA, Jumbo, Non-QM, or DSCR. For purpose use: Purchase, Rate/Term Refi, or Cash-Out Refi. For occupancy use: Owner Occupied, Second Home, or Investment. For incomeDocType use: Full Doc, Bank Statement 12 Month, Bank Statement 24 Month, 1099 Only, P&L Only, Asset Depletion, or No Income. For vestingType use: Individual, LLC, Trust, Layered LLC, Corporation, or Partnership — only set if explicitly mentioned. For adus use: None, 1 ADU, 2 ADUs, or 3+ ADUs — only set if ADU, accessory dwelling unit, guest house, casita, or in-law suite is explicitly mentioned. For condoWarrantability use: Warrantable, Non-warrantable, or Condotel — only set if explicitly mentioned. For deedRestriction use: None, Owner occupancy required, Resale restrictions, Income restrictions, or Affordability designation — only set if explicitly mentioned. Set interestOnly to true only if the description explicitly mentions interest only, IO, or an interest-only loan. For ltv: only calculate from property value and loan amount if both are explicitly stated and ltv itself is not given.",
          messages:[{role:"user",content:nlText}]
        })
      });
      if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error?.message||`API error ${res.status}`); }
      const data=await res.json();
      const raw=data.content?.[0]?.text||"";
      const match=raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Unexpected response — no JSON found");
      const p=JSON.parse(match[0]);
      const nn=v=>v!==null&&v!==undefined;
      const nextS={...scenario};
      if (nn(p.loanType)) nextS.loanType=p.loanType;
      if (nn(p.purpose)) nextS.purpose=p.purpose;
      if (nn(p.occupancy)) nextS.occupancy=p.occupancy;
      if (nn(p.propertyType)) nextS.propertyType=p.propertyType;
      if (nn(p.units)) nextS.units=String(p.units);
      if (nn(p.fico)) nextS.fico=String(p.fico);
      if (nn(p.ltv)) nextS.ltv=String(p.ltv);
      if (nn(p.dti)) nextS.dti=String(p.dti);
      if (nn(p.loanAmount)) nextS.loanAmount=String(p.loanAmount);
      if (nn(p.isHighBalance)) nextS.isHighBalance=Boolean(p.isHighBalance);
      if (nn(p.armRequested)) nextS.armRequested=Boolean(p.armRequested);
      if (nn(p.isSelfEmployed)) nextS.isSelfEmployed=Boolean(p.isSelfEmployed);
      if (nn(p.incomeLimitAmi)) nextS.incomeLimitAmi=String(p.incomeLimitAmi);
      if (nn(p.isManufactured)) nextS.isManufactured=Boolean(p.isManufactured);
      if (nn(p.isMhAdvantage)) nextS.isMhAdvantage=Boolean(p.isMhAdvantage);
      if (nn(p.hasForbearance)) nextS.hasForbearance=Boolean(p.hasForbearance);
      if (nn(p.hasDerogatory)) nextS.hasDerogatory=Boolean(p.hasDerogatory);
      if (nn(p.derogatoryType)) nextS.derogatoryType=p.derogatoryType;
      if (nn(p.derogatoryYearsAgo)) nextS.derogatoryYearsAgo=String(p.derogatoryYearsAgo);
      if (nn(p.state)) nextS.state=p.state;
      if (nn(p.priorFannieLoan)) nextS.priorFannieLoan=Boolean(p.priorFannieLoan);
      if (nn(p.dscrRatio)) nextS.dscrRatio=String(p.dscrRatio);
      if (nn(p.incomeDocType)) nextS.incomeDocType=p.incomeDocType;
      if (nn(p.interestOnly)) nextS.interestOnly=Boolean(p.interestOnly);
      if (nn(p.prepaymentPenaltyOk)) nextS.prepayPenaltyOk=Boolean(p.prepaymentPenaltyOk);
      if (nn(p.foreignNational)) nextS.isForeignNational=Boolean(p.foreignNational);
      if (nn(p.vestingType)) nextS.vestingType=p.vestingType;
      if (nn(p.adus)) nextS.adus=p.adus;
      if (nn(p.condoWarrantability)) nextS.condoWarrantability=p.condoWarrantability;
      if (nn(p.deedRestriction)) nextS.deedRestriction=p.deedRestriction;
      setScenario(nextS);
      const m={};
      if (nextS.fico) m.fico=parseInt(nextS.fico);
      if (nextS.ltv) m.ltv=parseFloat(nextS.ltv);
      if (nextS.dti) m.dti=parseFloat(nextS.dti);
      if (nextS.loanAmount) m.loanAmount=parseFloat(nextS.loanAmount);
      if (nextS.incomeLimitAmi) m.incomeLimitAmi=parseFloat(nextS.incomeLimitAmi);
      if (nextS.derogatoryYearsAgo) m.derogatoryYearsAgo=parseFloat(nextS.derogatoryYearsAgo);
      setResults(evaluateScenario({...nextS,...m},allPrograms));
      setFilter("all"); setExpandedId(null);
    } catch(e) {
      setParseError(e.message||"Failed to parse scenario");
    } finally {
      setIsParsing(false);
    }
  }

  async function askQuestion(questionText,loanTypeFilter) {
    const key=localStorage.getItem("ls_claude_api_key");
    if (!key) { setQaError("Add your Claude API key in the Admin panel first."); return; }
    if (!questionText.trim()) return;
    setQaIsLoading(true); setQaError("");
    try {
      const programContext=formatProgramContext(allPrograms,loanTypeFilter);
      const systemPrompt=[
        "You are an expert mortgage guideline assistant with deep knowledge of Fannie Mae, Freddie Mac, FHA, VA, USDA, Jumbo, and Non-QM guidelines. Answer mortgage guideline questions clearly and concisely. When relevant, mention specific guideline sources (e.g. Fannie Mae Selling Guide B3-4.3). Always note when something is a common overlay vs a base agency guideline.",
        "",
        "You have access to the following lender program data from this broker's actual lender relationships. Always prioritize this data over general knowledge when answering questions. If the loaded data conflicts with general guidelines, defer to the loaded lender data.",
        "",
        programContext
          ? "LOADED LENDER PROGRAM DATA:\n\n"+programContext
          : "No program data loaded yet.",
      ].join("\n");
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({
          model:"claude-haiku-4-5-20251001",
          max_tokens:1024,
          system:systemPrompt,
          messages:[{role:"user",content:`[Loan type filter: ${loanTypeFilter}] Question: ${questionText}`}]
        })
      });
      if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error?.message||`API error ${res.status}`); }
      const data=await res.json();
      const answer=data.content?.[0]?.text||"";
      const entry={id:Date.now(),question:questionText,loanType:loanTypeFilter,answer,timestamp:new Date().toISOString()};
      setQaAnswer(entry);
      setQaHistory(prev=>{
        const updated=[entry,...prev].slice(0,50);
        localStorage.setItem("ls_qa_history",JSON.stringify(updated));
        return updated;
      });
    } catch(e) {
      setQaError(e.message||"Failed to get answer");
    } finally {
      setQaIsLoading(false);
    }
  }

  const runSearch=useCallback(()=>{
    const m={};
    if(scenario.fico) m.fico=parseInt(scenario.fico);
    if(scenario.ltv) m.ltv=parseFloat(scenario.ltv);
    if(scenario.dti) m.dti=parseFloat(scenario.dti);
    if(scenario.loanAmount) m.loanAmount=parseFloat(scenario.loanAmount);
    if(scenario.incomeLimitAmi) m.incomeLimitAmi=parseFloat(scenario.incomeLimitAmi);
    if(scenario.derogatoryYearsAgo) m.derogatoryYearsAgo=parseFloat(scenario.derogatoryYearsAgo);
    setResults(evaluateScenario({...scenario,...m},allPrograms));
    setFilter("all"); setExpandedId(null);
  },[scenario,allPrograms]);

  const allLenderIds=[...new Set(allPrograms.map(p=>p.lenderId))];
  const lenderFiltered=!results?[]:lenderFilter.length===0?results:results.filter(r=>lenderFilter.includes(r.program.lenderId));
  const matchCount=lenderFiltered.filter(r=>r.matched).length;
  const failCount=lenderFiltered.filter(r=>!r.matched).length;
  const displayed=filter==="match"?lenderFiltered.filter(r=>r.matched):filter==="fail"?lenderFiltered.filter(r=>!r.matched):lenderFiltered;

  return (
    <>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <div style={{minHeight:"100vh",background:"#f8f7f4",fontFamily:"system-ui,sans-serif"}}>
      <header style={{background:"#1a1a18",padding:"0 24px",display:"flex",alignItems:"center",height:56,gap:16}}>
        <span style={{color:"#fff",fontWeight:600,fontSize:16}}>LenderSearch</span>
        <span style={{color:"#555",fontSize:13}}>|</span>
        <span style={{color:"#888",fontSize:13}}>{new Set(allPrograms.map(p=>p.lenderId)).size} lenders · {allPrograms.length} programs</span>
        <div style={{flex:1}}/>
        {[["search","Search"],["qa","Guidelines Q&A"],["admin","Admin"]].map(([v,label])=>(
          <button key={v} onClick={()=>{
            if (v==="search"&&qaLoanType!=="All Types"&&!scenario.loanType) set("loanType",qaLoanType);
            setView(v);
          }} style={{background:view===v?"#333":"transparent",color:view===v?"#fff":"#888",border:"none",borderRadius:6,padding:"6px 14px",fontSize:13,cursor:"pointer"}}>
            {label}
          </button>
        ))}
      </header>

      {view==="search"&&(
        <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 20px"}}>
          <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:20,alignItems:"start"}}>
            <div style={{background:"#fff",border:"0.5px solid #e0ddd6",borderRadius:12,padding:20}}>
              <div style={{fontSize:12,fontWeight:600,color:"#666",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:16}}>Loan scenario</div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={{border:"0.5px solid #e0ddd6",borderRadius:8,overflow:"hidden",marginBottom:2}}>
                  <button onClick={()=>setLenderFilterOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 12px",background:"#f7f6f3",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,color:"#555",textTransform:"uppercase",letterSpacing:"0.05em"}}>
                    <span>Lenders {lenderFilter.length>0?`(${lenderFilter.length} selected)`:""}</span>
                    <span style={{color:"#aaa",fontSize:14}}>{lenderFilterOpen?"▲":"▼"}</span>
                  </button>
                  {lenderFilterOpen&&(
                    <div style={{padding:"10px 12px",background:"#fff",display:"flex",flexDirection:"column",gap:6}}>
                      <div style={{display:"flex",gap:8,marginBottom:4}}>
                        <button onClick={()=>setLenderFilter(allLenderIds)} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"0.5px solid #d0cec6",background:"#f7f6f3",cursor:"pointer",color:"#555"}}>Select all</button>
                        <button onClick={()=>setLenderFilter([])} style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"0.5px solid #d0cec6",background:"#f7f6f3",cursor:"pointer",color:"#555"}}>Clear all</button>
                      </div>
                      {allLenderIds.map(lid=>{
                        const lender=SEED_LENDERS.find(l=>l.id===lid);
                        const checked=lenderFilter.includes(lid);
                        return (
                          <label key={lid} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,cursor:"pointer",color:"#333"}}>
                            <input type="checkbox" checked={checked} onChange={()=>setLenderFilter(prev=>checked?prev.filter(x=>x!==lid):[...prev,lid])} style={{width:14,height:14,cursor:"pointer"}}/>
                            {lender?.name||lid}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8,paddingBottom:14,borderBottom:"0.5px solid #eee"}}>
                  <textarea value={nlText} onChange={e=>setNlText(e.target.value)}
                    placeholder={"Describe the scenario — e.g. \"FHA purchase in Texas, 660 FICO, 96.5% LTV, $380k, owner occupied SFR, self-employed borrower\""}
                    style={{fontSize:13,lineHeight:1.45,padding:"9px 10px",borderRadius:8,border:"0.5px solid #d0cec6",background:"#fff",width:"100%",boxSizing:"border-box",resize:"vertical",minHeight:78,fontFamily:"system-ui,sans-serif"}}/>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <button onClick={parseScenario} disabled={!nlText.trim()||isParsing}
                      style={{background:"#1a1a18",color:"#fff",border:"none",borderRadius:8,padding:"7px 13px",fontSize:13,fontWeight:500,cursor:nlText.trim()&&!isParsing?"pointer":"default",opacity:nlText.trim()&&!isParsing?1:0.4,display:"flex",alignItems:"center",gap:6}}>
                      {isParsing&&<span style={{display:"inline-block",width:11,height:11,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>}
                      {isParsing?"Parsing...":"Parse scenario"}
                    </button>
                    {!localStorage.getItem("ls_claude_api_key")&&<span style={{fontSize:11,color:"#aaa"}}>API key required — set in Admin</span>}
                  </div>
                  {parseError&&<div style={{fontSize:12,color:"#a32d2d",padding:"6px 10px",background:"#fceaea",borderRadius:6}}>{parseError}</div>}
                </div>
                {sel("Loan type","loanType",LOAN_TYPES,scenario,set)}
                {sel("Purpose","purpose",PURPOSES,scenario,set)}
                {sel("Occupancy","occupancy",OCCUPANCIES,scenario,set)}
                {sel("Property type","propertyType",PROPERTY_TYPES,scenario,set)}
                {sel("Units","units",["1","2","3","4","5-8"],scenario,set)}
                {sel("State","state",STATES,scenario,set)}
                {inp("Credit score (FICO)","fico",scenario,set,"number","e.g. 680")}
                {inp("LTV (%)","ltv",scenario,set,"number","e.g. 80")}
                {inp("DTI (%)","dti",scenario,set,"number","e.g. 43")}
                {inp("Loan amount ($)","loanAmount",scenario,set,"number","e.g. 450000")}
                {inp("Income — % of AMI","incomeLimitAmi",scenario,set,"number","e.g. 75")}
                <div style={{borderTop:"0.5px solid #eee",paddingTop:12,display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:"#666",textTransform:"uppercase",letterSpacing:"0.05em"}}>Flags</div>
                  {chk("High balance / super conforming","isHighBalance",scenario,set)}
                  {chk("First-time homebuyer","isFirstTimeHomeBuyer",scenario,set)}
                  {chk("ARM requested","armRequested",scenario,set)}
                  {chk("Self-employed borrower","isSelfEmployed",scenario,set)}
                  {chk("Manufactured home","isManufactured",scenario,set)}
                  {chk("MH Advantage designation","isMhAdvantage",scenario,set)}
                  {chk("Active forbearance on existing loan","hasForbearance",scenario,set)}
                  {chk("Prior agency loan (RefiNow / Refi Possible)","priorFannieLoan",scenario,set)}
                </div>
                <div style={{borderTop:"0.5px solid #eee",paddingTop:12,display:"flex",flexDirection:"column",gap:8}}>
                  {chk("Borrower has derogatory event","hasDerogatory",scenario,set)}
                  {scenario.hasDerogatory&&<>{sel("Derogatory type","derogatoryType",DEROG_TYPES,scenario,set,"Select type")}{inp("Years since event","derogatoryYearsAgo",scenario,set,"number","e.g. 3")}</>}
                </div>
                <div style={{borderTop:"0.5px solid #eee",paddingTop:12,display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:"#666",textTransform:"uppercase",letterSpacing:"0.05em"}}>Non-QM / DSCR</div>
                  {sel("Income documentation","incomeDocType",INCOME_DOC_TYPES,scenario,set,"Any / Full Doc")}
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    <label style={{fontSize:11,color:"#666",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.05em"}}>DSCR ratio</label>
                    <select value={scenario.dscrRatio} onChange={e=>set("dscrRatio",e.target.value)}
                      style={{fontSize:14,padding:"8px 10px",borderRadius:8,border:"0.5px solid #d0cec6",background:"#fff",width:"100%",boxSizing:"border-box"}}>
                      {DSCR_RATIO_OPTIONS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  </div>
                  {chk("Interest only requested","interestOnly",scenario,set)}
                  {chk("Prepayment penalty acceptable","prepayPenaltyOk",scenario,set)}
                  {chk("Foreign national borrower","isForeignNational",scenario,set)}
                </div>
                <div style={{borderTop:"0.5px solid #eee",paddingTop:12,display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:"#666",textTransform:"uppercase",letterSpacing:"0.05em"}}>Title / property details</div>
                  {sel("Vesting type","vestingType",VESTING_TYPES,scenario,set,"Any")}
                  {sel("ADUs on property","adus",ADU_OPTIONS,scenario,set,"Not specified")}
                  {sel("Condo warrantability","condoWarrantability",CONDO_WARRANTABILITY,scenario,set,"Not applicable")}
                  {sel("Deed restrictions","deedRestriction",DEED_RESTRICTION_TYPES,scenario,set,"None")}
                </div>
                <div style={{display:"flex",gap:8,marginTop:4}}>
                  <button onClick={runSearch} style={{flex:1,background:"#1a1a18",color:"#fff",border:"none",borderRadius:8,padding:11,fontSize:14,fontWeight:500,cursor:"pointer"}}>Search programs</button>
                  <button onClick={()=>{setScenario(EMPTY);setResults(null);}} style={{background:"#f0ece4",color:"#555",border:"none",borderRadius:8,padding:"11px 14px",fontSize:13,cursor:"pointer"}}>Clear</button>
                </div>
              </div>
            </div>

            <div>
              {!results&&(
                <div style={{textAlign:"center",padding:"60px 20px",color:"#999",background:"#fff",border:"0.5px solid #e0ddd6",borderRadius:12}}>
                  <div style={{fontSize:40,marginBottom:12,opacity:0.2}}>🔍</div>
                  <div style={{fontSize:15}}>Enter a scenario and click Search programs</div>
                  <div style={{fontSize:13,marginTop:6}}>Results show which programs match and exactly why others don't</div>
                </div>
              )}
              {results&&(
                <>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                    <span style={{background:"#e8f5ef",color:"#0f6e56",padding:"4px 12px",borderRadius:8,fontSize:13,fontWeight:500}}>{matchCount} match{matchCount!==1?"es":""}</span>
                    <span style={{background:"#fceaea",color:"#a32d2d",padding:"4px 12px",borderRadius:8,fontSize:13,fontWeight:500}}>{failCount} do not match</span>
                    <div style={{flex:1}}/>
                    {["all","match","fail"].map(f=>(
                      <button key={f} onClick={()=>setFilter(f)} style={{padding:"5px 12px",fontSize:12,borderRadius:6,border:"0.5px solid #d0cec6",background:filter===f?"#1a1a18":"#fff",color:filter===f?"#fff":"#555",cursor:"pointer"}}>
                        {f==="all"?"All":f==="match"?"Matches only":"Non-matches"}
                      </button>
                    ))}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {displayed.map(r=>{
                      const {program,matched,fails,warnings,passes}=r;
                      const lender=SEED_LENDERS.find(l=>l.id===program.lenderId);
                      const expanded=expandedId===program.id;
                      return (
                        <div key={program.id} style={{background:"#fff",border:"0.5px solid #e0ddd6",borderLeft:`3px solid ${matched?"#1D9E75":"#E24B4A"}`,borderRadius:12,overflow:"hidden",opacity:matched?1:0.85}}>
                          <div onClick={()=>setExpandedId(expanded?null:program.id)} style={{padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:14,fontWeight:500,color:"#1a1a18"}}>{program.name}</span>
                                {program.partialData&&<span style={{fontSize:10,background:"#faeeda",color:"#854F0B",padding:"1px 6px",borderRadius:4}}>Partial data</span>}
                              </div>
                              <div style={{fontSize:12,color:"#888",marginTop:2}}>{lender?.name} · {program.agency} · {program.aus} · Min FICO {program.minFico}</div>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <span style={{background:matched?"#e8f5ef":"#fceaea",color:matched?"#0f6e56":"#a32d2d",fontSize:12,fontWeight:500,padding:"3px 10px",borderRadius:6}}>{matched?"Match":"No match"}</span>
                              {warnings.length>0&&<span style={{background:"#faeeda",color:"#854F0B",fontSize:11,padding:"3px 8px",borderRadius:6}}>{warnings.length} warning{warnings.length!==1?"s":""}</span>}
                              <span style={{color:"#aaa",fontSize:16}}>{expanded?"▲":"▼"}</span>
                            </div>
                          </div>
                          {expanded&&(
                            <div style={{borderTop:"0.5px solid #eee",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
                              {passes.length>0&&<div>
                                <div style={{fontSize:11,fontWeight:600,color:"#0f6e56",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Criteria met</div>
                                {passes.map((p,i)=><div key={i} style={{display:"flex",gap:8,marginBottom:4,alignItems:"flex-start"}}><span style={{color:"#1D9E75",flexShrink:0}}>✓</span><span style={{fontSize:13,color:"#333"}}>{p}</span></div>)}
                              </div>}
                              {fails.length>0&&<div>
                                <div style={{fontSize:11,fontWeight:600,color:"#a32d2d",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Does not match — reasons</div>
                                {fails.map((f,i)=><div key={i} style={{display:"flex",gap:8,marginBottom:4,alignItems:"flex-start"}}><span style={{color:"#E24B4A",flexShrink:0}}>✕</span><span style={{fontSize:13,color:"#555"}}>{f}</span></div>)}
                              </div>}
                              {warnings.length>0&&<div>
                                <div style={{fontSize:11,fontWeight:600,color:"#854F0B",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Conditions / warnings</div>
                                {warnings.map((w,i)=><div key={i} style={{display:"flex",gap:8,marginBottom:4,alignItems:"flex-start"}}><span style={{color:"#EF9F27",flexShrink:0}}>!</span><span style={{fontSize:13,color:"#555"}}>{w}</span></div>)}
                              </div>}
                              <div style={{background:"#f8f7f4",borderRadius:8,padding:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>
                                {[["Purposes",program.purposes?.join(", ")],["Occupancy",program.occupancy?.join(", ")],["Max DTI",program.maxDti?`${program.maxDti}%`:program.dtiNote],["Income limit",program.incomeLimit||"None"],["High balance",program.highBalance?"Yes":"No"],["ARMs",program.armsAllowed===false?"No":"Yes"],["Cash-out",program.cashOutAllowed===false?"No":"Yes"],["Manual UW",program.manualUw?"Yes":"No"]].map(([label,val])=>val&&(
                                  <div key={label}><span style={{fontSize:11,color:"#888"}}>{label}: </span><span style={{fontSize:12,fontWeight:500,color:"#333"}}>{val}</span></div>
                                ))}
                              </div>
                              {program.overlays?.length>0&&(
                                <details><summary style={{fontSize:12,color:"#888",cursor:"pointer"}}>View all {program.overlays.length} overlays</summary>
                                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                                    {program.overlays.map((o,i)=><div key={i} style={{fontSize:12,color:"#555",paddingLeft:12,borderLeft:"2px solid #E24B4A"}}>{o}</div>)}
                                  </div>
                                </details>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {view==="qa"&&(
        <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 20px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:20,alignItems:"start"}}>
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div style={{background:"#fff",border:"0.5px solid #e0ddd6",borderRadius:12,padding:20}}>
                <div style={{fontSize:12,fontWeight:600,color:"#666",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Guidelines Q&A</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
                  {["All Types","Conventional","FHA","VA","USDA","Jumbo","Non-QM"].map(lt=>(
                    <button key={lt} onClick={()=>setQaLoanType(lt)}
                      style={{padding:"5px 12px",fontSize:12,borderRadius:20,border:`0.5px solid ${qaLoanType===lt?"#1a1a18":"#d0cec6"}`,background:qaLoanType===lt?"#1a1a18":"#f7f6f3",color:qaLoanType===lt?"#fff":"#555",cursor:"pointer",fontWeight:qaLoanType===lt?500:400}}>
                      {lt}
                    </button>
                  ))}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
                  {["Gift funds on investment property?","Max DTI for FHA?","VA funding fee exemptions?","Non-occupant co-borrower rules?","Cash-out refi seasoning?","Self-employed income requirements?"].map(q=>(
                    <button key={q} onClick={()=>setQaQuestion(q)}
                      style={{padding:"5px 11px",fontSize:12,borderRadius:6,border:"0.5px solid #d0cec6",background:"#f7f6f3",color:"#555",cursor:"pointer"}}>
                      {q}
                    </button>
                  ))}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <input value={qaQuestion} onChange={e=>setQaQuestion(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"&&qaQuestion.trim()&&!qaIsLoading)askQuestion(qaQuestion,qaLoanType);}}
                    placeholder="Ask a mortgage guideline question..."
                    style={{flex:1,fontSize:14,padding:"9px 12px",borderRadius:8,border:"0.5px solid #d0cec6",background:"#fff",fontFamily:"system-ui,sans-serif",boxSizing:"border-box"}}/>
                  <button onClick={()=>askQuestion(qaQuestion,qaLoanType)} disabled={!qaQuestion.trim()||qaIsLoading}
                    style={{background:"#1a1a18",color:"#fff",border:"none",borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:500,cursor:qaQuestion.trim()&&!qaIsLoading?"pointer":"default",opacity:qaQuestion.trim()&&!qaIsLoading?1:0.4,display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
                    {qaIsLoading&&<span style={{display:"inline-block",width:11,height:11,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>}
                    {qaIsLoading?"Asking...":"Ask ↗"}
                  </button>
                </div>
                {qaError&&<div style={{fontSize:12,color:"#a32d2d",padding:"6px 10px",background:"#fceaea",borderRadius:6,marginTop:8}}>{qaError}</div>}
                {!localStorage.getItem("ls_claude_api_key")&&<div style={{fontSize:11,color:"#aaa",marginTop:8}}>API key required — set in Admin</div>}
              </div>

              {!qaAnswer&&!qaIsLoading&&(
                <div style={{textAlign:"center",padding:"48px 20px",color:"#999",background:"#fff",border:"0.5px solid #e0ddd6",borderRadius:12}}>
                  <div style={{fontSize:15,marginBottom:6}}>Ask a guideline question to get started</div>
                  <div style={{fontSize:13}}>Select a loan type above, click a suggestion, or type your own question</div>
                </div>
              )}

              {qaAnswer&&(
                <div style={{background:"#fff",border:"0.5px solid #e0ddd6",borderRadius:12,padding:20}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                    <span style={{background:"#f0ece4",color:"#555",padding:"2px 8px",borderRadius:4,fontSize:11,flexShrink:0}}>{qaAnswer.loanType}</span>
                    <span style={{fontSize:13,color:"#888",fontStyle:"italic"}}>{qaAnswer.question}</span>
                  </div>
                  <div style={{fontSize:14,color:"#1a1a18",lineHeight:1.65,whiteSpace:"pre-wrap"}}>{qaAnswer.answer}</div>
                  <div style={{marginTop:14,padding:"8px 12px",background:"#f8f7f4",borderRadius:6,border:"0.5px solid #e0ddd6"}}>
                    <span style={{fontSize:11,color:"#999"}}>Based on programs currently loaded in this app. Always verify with current lender guidelines before submitting.</span>
                  </div>
                  <div style={{marginTop:12}}>
                    <button onClick={()=>{
                      const lt=qaAnswer.loanType==="All Types"?"":qaAnswer.loanType;
                      set("loanType",lt);
                      setView("search");
                    }} style={{background:"#f0ece4",color:"#1a1a18",border:"none",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:500}}>
                      Find lenders for this ↗
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{background:"#fff",border:"0.5px solid #e0ddd6",borderRadius:12,padding:20}}>
              <div style={{fontSize:12,fontWeight:600,color:"#666",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:14}}>Saved questions</div>
              {qaHistory.length===0?(
                <div style={{fontSize:12,color:"#aaa",textAlign:"center",padding:"24px 0"}}>No questions asked yet</div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:560,overflowY:"auto"}}>
                  {qaHistory.map(item=>(
                    <div key={item.id} style={{border:"0.5px solid #e0ddd6",borderRadius:8,padding:"10px 12px"}}>
                      <div style={{display:"flex",alignItems:"flex-start",gap:6,marginBottom:8}}>
                        <span style={{background:"#f0ece4",color:"#555",padding:"1px 6px",borderRadius:4,fontSize:10,flexShrink:0,marginTop:1}}>{item.loanType}</span>
                        <span style={{fontSize:12,color:"#333",lineHeight:1.4}}>{item.question}</span>
                      </div>
                      <button onClick={()=>{setQaQuestion(item.question);setQaLoanType(item.loanType);askQuestion(item.question,item.loanType);}}
                        style={{fontSize:11,padding:"3px 8px",borderRadius:5,border:"0.5px solid #d0cec6",background:"#f7f6f3",cursor:"pointer",color:"#555"}}>
                        Ask again
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {qaHistory.length>0&&(
                <button onClick={()=>{setQaHistory([]);localStorage.removeItem("ls_qa_history");}}
                  style={{marginTop:12,fontSize:11,color:"#bbb",background:"none",border:"none",cursor:"pointer",padding:0,display:"block"}}>
                  Clear history
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {view==="admin"&&(
        <div style={{maxWidth:900,margin:"0 auto",padding:"24px 20px"}}>
          <div style={{fontSize:20,fontWeight:500,color:"#1a1a18",marginBottom:4}}>Admin panel</div>
          <div style={{fontSize:13,color:"#888",marginBottom:20}}>{SEED_PROGRAMS.length} seed programs + {customPrograms.length} custom programs loaded</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[...SEED_PROGRAMS,...customPrograms].map(p=>{
              const lender=SEED_LENDERS.find(l=>l.id===p.lenderId);
              const isCustom=customPrograms.some(c=>c.id===p.id);
              return (
                <div key={p.id} style={{background:"#fff",border:"0.5px solid #e0ddd6",borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:500,color:"#1a1a18"}}>{p.name}</div>
                    <div style={{fontSize:12,color:"#888",marginTop:2}}>{lender?.name} · {p.agency} · Min FICO {p.minFico} · {p.updatedDate}
                      {p.partialData&&<span style={{marginLeft:6,background:"#faeeda",color:"#854F0B",fontSize:10,padding:"1px 5px",borderRadius:4}}>Partial</span>}
                    </div>
                  </div>
                  {isCustom&&<button onClick={()=>{if(window.confirm("Delete?"))setCustomPrograms(prev=>{const n=prev.filter(c=>c.id!==p.id);localStorage.setItem("ls_programs",JSON.stringify(n));return n;})}} style={{background:"transparent",border:"none",cursor:"pointer",color:"#ccc",fontSize:18}}>🗑</button>}
                </div>
              );
            })}
          </div>
          <div style={{marginTop:24,background:"#fff",border:"0.5px solid #e0ddd6",borderRadius:12,padding:20}}>
            <div style={{fontSize:14,fontWeight:500,marginBottom:4}}>Claude API key</div>
            <div style={{fontSize:12,color:"#888",marginBottom:12}}>Used for natural language scenario parsing. Stored in localStorage only — never sent anywhere except Anthropic.</div>
            <input type="password" defaultValue={localStorage.getItem("ls_claude_api_key")||""}
              onChange={e=>localStorage.setItem("ls_claude_api_key",e.target.value)}
              placeholder="sk-ant-..."
              style={{width:"100%",fontSize:13,padding:"8px 10px",borderRadius:8,border:"0.5px solid #d0cec6",background:"#fff",boxSizing:"border-box",fontFamily:"monospace"}}/>
          </div>
          <div style={{marginTop:16,background:"#fff",border:"0.5px solid #e0ddd6",borderRadius:12,padding:20}}>
            <div style={{fontSize:14,fontWeight:500,marginBottom:12}}>Add program</div>
            {pendingConflict?(
              <div style={{background:"#faeeda",border:"0.5px solid #f0c97a",borderRadius:8,padding:14}}>
                <div style={{fontSize:13,fontWeight:600,color:"#854F0B",marginBottom:6}}>Duplicate detected</div>
                <div style={{fontSize:13,color:"#555",marginBottom:12}}>
                  A program named <strong>{pendingConflict.existing.name}</strong> for <strong>{SEED_LENDERS.find(l=>l.id===pendingConflict.existing.lenderId)?.name||pendingConflict.existing.lenderId}</strong> already exists
                  {pendingConflict.isCustom?" as a custom program":" as a built-in seed program"}.
                  {!pendingConflict.isCustom&&" Built-in programs cannot be updated from the admin panel."}
                </div>
                <div style={{display:"flex",gap:8}}>
                  {pendingConflict.isCustom&&(
                    <button onClick={()=>commitProgram(pendingConflict.incoming,pendingConflict.existing.id)}
                      style={{background:"#1a1a18",color:"#fff",border:"none",borderRadius:6,padding:"7px 14px",fontSize:13,cursor:"pointer"}}>
                      Update existing
                    </button>
                  )}
                  <button onClick={()=>setPendingConflict(null)}
                    style={{background:"#f0ece4",color:"#555",border:"none",borderRadius:6,padding:"7px 14px",fontSize:13,cursor:"pointer"}}>
                    Skip
                  </button>
                </div>
              </div>
            ):(
              <>
                <textarea value={importJson} onChange={e=>setImportJson(e.target.value)}
                  placeholder={'Paste program JSON here, e.g. {"name":"...","lenderId":"pennymac",...}'}
                  style={{width:"100%",height:100,fontSize:12,fontFamily:"monospace",padding:10,borderRadius:8,border:"0.5px solid #d0cec6",boxSizing:"border-box",resize:"vertical"}}/>
                {importError&&<div style={{fontSize:12,color:"#a32d2d",marginTop:4}}>{importError}</div>}
                <button onClick={handleImport} disabled={!importJson.trim()}
                  style={{marginTop:8,background:"#1a1a18",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,cursor:importJson.trim()?"pointer":"default",opacity:importJson.trim()?1:0.4}}>
                  Import program
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  );
}
