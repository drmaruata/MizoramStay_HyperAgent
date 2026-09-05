# Mizoram Tourism Marketplace
## Technical Architecture, Database Schema, UI/UX Specification & Development Roadmap
Working product: MizoramStay
Product: Mizoram Tourism Marketplace & Homestay Management Platform
Architecture: Modular, API-first, cloud-native
Primary stack: Next.js + TypeScript + PostgreSQL
Secondary stack: Python for AI/data services
Initial platform: Responsive Web + PWA
Target: Production MVP followed by marketplace expansion

# 1. System Architecture
The system should be designed as a modular monolith initially, with clearly separated domains.
Do not begin with microservices.
A modular monolith will provide substantially lower development and operational complexity while preserving the ability to extract services later.
## 1.1 High-Level Architecture
┌─────────────────────┐
 │ TOURIST │
 │ Web / PWA / Mobile │
 └──────────┬──────────┘
 │
 ┌──────────▼──────────┐
 │ Next.js │
 │ Web Application │
 └──────────┬──────────┘
 │
 ┌──────────▼──────────┐
 │ API / BFF Layer │
 └──────────┬──────────┘
 │
 ┌────────────────────────────┼────────────────────────────┐
 │ │ │
┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
│ Booking │ │ Property │ │ User │
│ Domain │ │ Domain │ │ Domain │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘
 │ │ │
 └────────────────────────────┼────────────────────────────┘
 │
 ┌──────────▼──────────┐
 │ PostgreSQL │
 └──────────┬──────────┘
 │
 ┌─────────────────────┼─────────────────────┐
 │ │ │
 ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
 │ Redis │ │ Object │ │ Search │
 │ Cache │ │ Storage │ │ Engine │
 └─────────────┘ └─────────────┘ └─────────────┘

 │
 ┌──────────▼──────────┐
 │ Notification Layer │
 │ Email/SMS/WhatsApp │
 └─────────────────────┘

 │
 ┌──────────▼──────────┐
 │ Payment Gateway │
 └─────────────────────┘

# 2. Application Domains
The application should be divided into the following logical modules.
/auth
/users
/properties
/rooms
/availability
/pricing
/search
/bookings
/payments
/refunds
/reviews
/destinations
/experiences
/transport
/promotions
/notifications
/verification
/analytics
/admin
Later:
/ai
/recommendations
/packages
/b2b
/partner-api

# 3. Frontend Architecture
Use:
Next.js
TypeScript
React
Tailwind CSS v4
shadcn/ui component library (Base UI primitives, source components in `src/components/ui/`)
React Hook Form
Zod validation
Design tokens: project palette (cream `#f8f5ef`, leaf `#2f6b4f`, marigold `#e6ad42`, ink `#17332e`) mapped to shadcn CSS variables in `src/app/globals.css`. Use semantic tokens (`bg-primary`, `text-muted-foreground`) — never raw hex values in components.
Recommended application areas:
app/
├── (public)/
│ ├── page.tsx
│ ├── destinations/
│ ├── stays/
│ ├── experiences/
│ ├── travel-guides/
│ └── search/
│
├── booking/
├── account/
│
├── host/
│ ├── dashboard/
│ ├── properties/
│ ├── rooms/
│ ├── calendar/
│ ├── bookings/
│ ├── revenue/
│ └── reviews/
│
└── admin/
 ├── dashboard/
 ├── properties/
 ├── verification/
 ├── bookings/
 ├── users/
 ├── payments/
 ├── destinations/
 └── analytics/

# 4. Backend Architecture
Initially use a modular backend inside the Next.js application.
Each domain should have:
controller/API
service
repository
validation
authorization
events
tests
Example:
booking/
├── booking.controller.ts
├── booking.service.ts
├── booking.repository.ts
├── booking.schema.ts
├── booking.events.ts
└── booking.test.ts
This keeps domain boundaries clear without the overhead of distributed services.

# 5. Future Service Extraction
When scale justifies it, the following can become independent services:
Booking Service
Payment Service
Search Service
Notification Service
Recommendation Service
AI Travel Service
Analytics Service
Media Service
Do not extract them during MVP unless a real scaling requirement exists.

# 6. Database Architecture
Use PostgreSQL as the system of record.
The database should be normalized around the following major domains:
Identity
Properties
Accommodation
Inventory
Bookings
Payments
Reviews
Destinations
Experiences
Transport
Verification
Marketing
Analytics

# 7. Core Database Schema
## Users
users
-----
id UUID PK
email
phone
password_hash
role
first_name
last_name
status
language
created_at
updated_at
last_login_at
Roles:
TOURIST
HOST
GUIDE
DRIVER
OPERATOR
ADMIN
SUPER_ADMIN

# 8. Host Profile
host_profiles
-------------
id UUID PK
user_id UUID FK
display_name
bio
profile_photo_url
identity_status
bank_account_status
rating
total_bookings
created_at
updated_at

# 9. Property
properties
----------
id UUID PK
host_id UUID FK
name
slug
property_type
description
address
village
town
district
pincode
latitude
longitude
check_in_time
check_out_time
status
verification_level
tourism_registration_number
tourism_registration_status
created_at
updated_at
published_at
Property types:
HOMESTAY
HOTEL
GUESTHOUSE
LODGE
RESORT
VILLAGE_STAY
OTHER

# 10. Property Documents
property_documents
------------------
id UUID PK
property_id UUID FK
document_type
document_number
file_url
verification_status
verified_by
verified_at
expiry_date
created_at
Document types can include:
IDENTITY
OWNERSHIP
TOURISM_REGISTRATION
POLICE_CLEARANCE
ADDRESS_PROOF
BANK_PROOF
OTHER
The exact requirements should be configurable because regulatory requirements can change.

# 11. Rooms
rooms
-----
id UUID PK
property_id UUID FK
name
description
room_type
max_guests
beds
bed_type
bathroom_type
room_size
base_price
status
created_at
updated_at

# 12. Amenities
amenities
---------
id UUID PK
name
category
icon
status
Relationship:
property_amenities
------------------
property_id
amenity_id
and:
room_amenities
--------------
room_id
amenity_id

# 13. Availability
room_inventory
--------------
id UUID PK
room_id UUID FK
date
available_units
blocked_units
created_at
updated_at
For an individual homestay room, available_units will normally be 0 or 1.

# 14. Pricing
room_prices
-----------
id UUID PK
room_id UUID FK
date
base_price
weekend_price
seasonal_price
special_price
minimum_stay
created_at
updated_at
Later:
pricing_rules
-------------
season
event
occupancy_threshold
advance_booking_window
minimum_stay
discount

# 15. Bookings
bookings
--------
id UUID PK
booking_reference
user_id UUID FK
property_id UUID FK
check_in
check_out
guests
rooms
subtotal
discount
tax
platform_fee
total_amount
currency
status
cancellation_policy
created_at
updated_at
Statuses:
PENDING
CONFIRMED
CANCELLED
COMPLETED
NO_SHOW
REFUND_PENDING
REFUNDED

# 16. Booking Items
booking_items
-------------
id UUID PK
booking_id UUID FK
room_id UUID FK
check_in
check_out
quantity
nightly_rate
subtotal
This permits multiple rooms in one booking.

# 17. Guests
booking_guests
--------------
id UUID PK
booking_id UUID FK
first_name
last_name
phone
email
age_group
special_requirements
Avoid storing unnecessary identity information.

# 18. Payments
payments
--------
id UUID PK
booking_id UUID FK
provider
provider_transaction_id
amount
currency
status
payment_method
paid_at
created_at
Statuses:
INITIATED
AUTHORIZED
CAPTURED
FAILED
REFUNDED
PARTIALLY_REFUNDED

# 19. Host Payouts
host_payouts
------------
id UUID PK
booking_id UUID FK
host_id UUID FK
gross_amount
platform_commission
payment_cost
refund_adjustment
net_amount
status
scheduled_at
paid_at
This table is critical for marketplace accounting.

# 20. Reviews
reviews
-------
id UUID PK
booking_id UUID FK
user_id UUID FK
property_id UUID FK
rating
cleanliness_rating
location_rating
hospitality_rating
facilities_rating
value_rating
comment
status
created_at
Only completed bookings should be eligible for verified reviews.

# 21. Host Review Response
review_responses
----------------
id UUID PK
review_id UUID FK
host_id UUID FK
response
created_at
updated_at

# 22. Destinations
destinations
------------
id UUID PK
name
slug
district
description
short_description
latitude
longitude
hero_image
best_time
travel_information
status
seo_title
seo_description
created_at
updated_at

# 23. Attractions
attractions
-----------
id UUID PK
destination_id UUID FK
name
description
latitude
longitude
category
best_time
entry_fee
duration
status

# 24. Experiences
experiences
-----------
id UUID PK
provider_id UUID FK
destination_id UUID FK
name
description
category
duration
price
max_group_size
difficulty
requirements
status
created_at
updated_at

# 25. Experience Availability
experience_inventory
--------------------
id UUID PK
experience_id UUID FK
date
start_time
capacity
remaining_capacity
price

# 26. Transport
transport_providers
-------------------
id UUID PK
user_id UUID FK
provider_type
name
phone
license_status
verification_status
rating
status
vehicles
--------
id UUID PK
provider_id UUID FK
vehicle_type
registration_number
capacity
price_per_day
price_per_km
status
Sensitive vehicle/identity data should have restricted access.

# 27. Verification
verification_cases
------------------
id UUID PK
property_id UUID FK
verification_type
risk_level
status
assigned_to
submitted_at
completed_at
notes
Possible verification types:
DOCUMENT
PHONE
IDENTITY
TOURISM_REGISTRATION
PROPERTY_VISIT
QUALITY

# 28. Verification Audit
verification_events
-------------------
id UUID PK
case_id UUID FK
actor_id UUID FK
action
old_status
new_status
notes
created_at
Every administrative verification decision should be auditable.

# 29. Promotions
promotions
----------
id UUID PK
name
type
code
discount_type
discount_value
minimum_booking_value
start_date
end_date
usage_limit
status

# 30. Wishlist
wishlists
---------
id UUID PK
user_id UUID FK
property_id UUID FK
created_at

# 31. Notifications
notifications
-------------
id UUID PK
user_id UUID FK
type
channel
subject
body
status
sent_at
created_at

# 32. Audit Logs
audit_logs
----------
id UUID PK
actor_id
entity_type
entity_id
action
old_values
new_values
ip_address
user_agent
created_at
Do not expose these records to normal users.

# 33. Key Database Relationships
User
 ├── HostProfile
 │ └── Property
 │ ├── Rooms
 │ │ ├── Inventory
 │ │ ├── Prices
 │ │ └── Amenities
 │ ├── Documents
 │ ├── Verification
 │ └── Reviews
 │
 └── Booking
 ├── BookingItems
 ├── Guests
 ├── Payment
 ├── Refund
 └── Review

# 34. Booking Transaction Logic
The booking process must be transactional.
Search
 ↓
Select Room
 ↓
Check Availability
 ↓
Temporary Inventory Lock
 ↓
Create Booking
 ↓
Initiate Payment
 ↓
Payment Confirmation
 ↓
Confirm Booking
 ↓
Reduce Inventory
 ↓
Generate Confirmation
 ↓
Notify Host
If payment fails:
Payment Failure
 ↓
Release Inventory Lock
 ↓
Mark Booking Failed
Concurrency control is essential to prevent double booking.

# 35. API Architecture
Use REST initially.
Example:
GET /api/v1/properties
GET /api/v1/properties/:id
GET /api/v1/properties/:id/availability
POST /api/v1/bookings
GET /api/v1/bookings/:id
POST /api/v1/payments
POST /api/v1/reviews
POST /api/v1/hosts/properties
PATCH /api/v1/hosts/properties/:id
Admin:
GET /api/v1/admin/properties/pending
POST /api/v1/admin/properties/:id/approve
POST /api/v1/admin/properties/:id/reject
API versioning:
/api/v1/
from the beginning.

# 36. Authentication
Initial:
Mobile OTP
Email/password optional
Social login later
Admin:
Password + MFA
Host:
Phone OTP + device/session controls
Authorization:
RBAC.

# 37. UI/UX Architecture
The platform has three distinct experiences.
## Tourist
Emotionally driven, visual, discovery-oriented.
## Host
Operational, simple, task-oriented.
## Admin
Data-heavy, workflow-oriented.
Do not use the same navigation architecture for all three.

# 38. Tourist UI
## Homepage
Hero:
Discover Mizoram. Stay local. Travel deeper.
Search:
Where?
Check-in
Check-out
Guests
[Search]
Below:
Popular destinations
Verified homestays
Recommended stays
Experiences
Travel guides
Suggested itineraries

# 39. Search Results
Desktop:
----------------------------------------------------
Search / Filter Map
----------------------------------------------------
Filters Property cards
 ┌──────────────────────┐
Price │ Photo │
Property │ Property Name │
Facilities │ ★ 4.7 | Verified │
Rating │ ₹1,800/night │
 │ [View] │
 └──────────────────────┘
----------------------------------------------------
Mobile:
Filter button
Sort button
Property cards
Map toggle

# 40. Property Card
Each card should show:
Large image
Property name
Destination
Rating
Verification badge
Property type
Key amenities
Price
Cancellation information
Example:
[PHOTO]

Mizoram Hills Homestay
Aizawl

★★★★★ 4.8
✓ Verified
✓ Tourism Registered

Wi-Fi • Breakfast • Parking

₹1,800 / night

[View Stay]

# 41. Property Detail Page
Structure:
Photos
↓
Name + Location
↓
Verification
↓
Description
↓
Rooms
↓
Amenities
↓
Map
↓
House rules
↓
Reviews
↓
Cancellation
↓
Booking widget
On desktop, booking widget should remain sticky.

# 42. Trust UI
Trust should be visually prominent.
Use badges:
✓ Identity Verified
✓ Documents Verified
✓ Tourism Registration Verified
✓ Property Verified
Each badge should open an explanation of what the verification actually means.
Do not claim government certification unless officially granted.

# 43. Booking UI
Three stages:
1. Stay details
2. Guest details
3. Payment
Display:
Room
Dates
Guests
Price
Taxes/fees
Cancellation policy
Total
Avoid surprises at payment.

# 44. Booking Confirmation
Display:
✓ Booking Confirmed

Booking ID: MZ-XXXXXX

Property
Check-in
Check-out
Guests
Total paid

[View Booking]
[Contact Host]
[Add to Calendar]

# 45. Tourist Account
Sections:
Profile
Trips
Wishlist
Reviews
Payments
Notifications
Support

# 46. Host UX
Host dashboard should prioritize action.
Top section:
Good morning

Today's bookings: 3
Upcoming guests: 8
This month's revenue: ₹XX,XXX

[View Calendar]
Navigation:
Dashboard
Calendar
Bookings
Property
Rooms
Pricing
Reviews
Revenue
Promotions
Support
Settings

# 47. Host Calendar
Use a visual calendar.
States:
Available
Booked
Blocked
Pending
Host can tap a date to:
Block
Open
Change price
View booking

# 48. Host Onboarding UX
Use a progress indicator:
Profile ✓
Property ✓
Documents ✓
Rooms 60%
Photos 0%
Pricing 0%
Verification 0%
Do not present a 20-field form on one screen.
Use a guided wizard.

# 49. Admin UX
Admin dashboard:
Properties 428
Pending 37
Bookings 1,284
GMV ₹XX
Revenue ₹XX
Active Hosts 351
Map:
Aizawl ●●●●●●
Champhai ●●●
Lunglei ●●
Serchhip ●●
Mamit ●

# 50. Admin Verification UI
Left:
Application information.
Middle:
Documents/photos.
Right:
Verification checklist.
Actions:
Approve
Request Changes
Reject
Schedule Inspection

# 51. Design System
Visual identity should communicate:
Northeast India
Nature
Authenticity
Trust
Hospitality
Modern technology
Avoid making the interface look like a generic hotel OTA.
Photography should be a major part of the design.
Use local landscape and property imagery extensively.

# 52. Accessibility
Target WCAG 2.2 AA where practical.
Requirements:
Keyboard navigation
Alt text
Sufficient contrast
Screen-reader support
Accessible forms
Error messages
Focus states
Large touch targets

# 53. Responsive Design
Breakpoints should support:
Mobile
Tablet
Laptop
Desktop
Host experience should be designed mobile-first.

# 54. SEO Architecture
URLs:
/stays
/stays/aizawl
/stays/champhai
/stays/lunglei
/destinations/reiek
/destinations/hmuifang
/experiences
/travel-guides
Property:
/stays/aizawl/mizoram-hills-homestay
Generate:
metadata
Open Graph
structured data
sitemap
canonical URLs
destination landing pages

# 55. Analytics Events
Track:
search_started
search_completed
property_viewed
availability_checked
booking_started
payment_started
payment_completed
booking_completed
review_submitted
wishlist_added
host_registered
property_submitted
property_approved
host_booking_received
This is required to understand the marketplace funnel.

# 56. Core Funnel
Measure:
Visitors
 ↓
Searchers
 ↓
Property viewers
 ↓
Availability checks
 ↓
Booking starts
 ↓
Payment attempts
 ↓
Completed bookings
Primary optimization target:
Search → Completed Booking

# 57. Development Roadmap
## Phase 0 — Discovery
Duration: 4–6 weeks.
Deliverables:
Market research
30–50 host interviews
30–50 tourist interviews
Competitor analysis
Regulatory mapping
Property data model
UX prototype
Financial validation
Gate:
Proceed only if sufficient supply and demand evidence exists.

# 58. Phase 1 — Foundation
Duration: 3–4 weeks.
Build:
Repository
CI/CD
Authentication
Database
Design system
User roles
Object storage
Logging
Monitoring
Basic admin

# 59. Phase 2 — Property Marketplace
Duration: 4–6 weeks.
Build:
Host registration
Property onboarding
Documents
Rooms
Amenities
Photos
Availability
Pricing
Search
Property pages

# 60. Phase 3 — Booking & Payments
Duration: 4–6 weeks.
Build:
Booking engine
Inventory locks
Payment integration
Confirmation
Cancellation
Refund
Host payout
Notifications

# 61. Phase 4 — Reviews & Operations
Duration: 2–4 weeks.
Build:
Reviews
Host responses
Verification workflow
Support
Audit logs
Admin analytics

# 62. Phase 5 — Pilot
Duration: 4 weeks.
Target:
50–100 properties
25–50 verified properties
Initial tourist acquisition
First real bookings
Do not launch statewide marketing before operational validation.

# 63. Phase 6 — Public Launch
Duration: 4–8 weeks.
Targets:
150+ active properties
100+ verified properties
Destination SEO
Paid acquisition
Partnerships
Travel-agent outreach

# 64. Phase 7 — Marketplace Expansion
After accommodation-marketplace validation:
Experiences
Transport
Packages
Guides
Events

# 65. Phase 8 — AI Layer
Only after sufficient structured data exists.
Build:
AI Trip Planner
Recommendation Engine
Host AI Assistant
Review Intelligence
Demand Forecasting
Pricing Recommendations

# 66. Development Priorities
Priority P0:
Authentication
Property onboarding
Verification
Search
Availability
Booking
Payment
Admin
Notifications
P1:
Reviews
Wishlist
Promotions
Analytics
SEO CMS
P2:
Experiences
Transport
Packages
P3:
AI
B2B
Advanced pricing

# 67. Engineering Quality Requirements
Every major module should have:
Unit tests
Integration tests
API tests
Authorization tests
Error handling
Logging
Critical flows require end-to-end testing:
Host registration
Property approval
Search
Booking
Payment
Cancellation
Refund
Payout
Review

# 68. CI/CD
Recommended:
GitHub
 ↓
Pull Request
 ↓
Lint
 ↓
Type Check
 ↓
Unit Tests
 ↓
Build
 ↓
Preview Deployment
 ↓
E2E Tests
 ↓
Production
Deploy through Vercel or equivalent cloud infrastructure.

# 69. Environments
Maintain:
development
staging
production
Never test payment flows directly against production credentials.

# 70. Observability
Implement:
Application logs
Error tracking
Performance monitoring
Database monitoring
Payment monitoring
Booking failure monitoring
Critical alerts:
Payment failure spike
Booking confirmation failures
Database errors
API latency
Authentication failures
Notification failures

# 71. Disaster Recovery
Required:
Automated database backups
Point-in-time recovery where supported
Object-storage versioning
Disaster recovery documentation
Restore testing

# 72. Financial Model Architecture
The financial model should be driven by marketplace unit economics.
Primary variables:
Active Properties
×
Rooms / Property
×
365
×
Platform-attributable Occupancy
×
Average Nightly Rate
=
Accommodation GMV
Then:
Accommodation GMV
+
Experience GMV
+
Transport GMV
=
Total GMV
Revenue:
Accommodation commission
+
Experience commission
+
Transport commission
+
Subscriptions
+
Featured listings
=
Platform Revenue
Costs:
Payment costs
+
Verification
+
Payroll
+
Marketing
+
Operations
+
Technology
=
Operating Costs
Therefore:
EBITDA =
Contribution Margin
-
Operating Costs

# 73. Base-Case Planning Model
The attached spreadsheet uses an illustrative base case:
These assumptions are intentionally editable.
They should be replaced with actual field research before investment decisions.

# 74. Financial Model Scenarios
The production financial model should ultimately contain:
### Conservative
Low supply acquisition
Low occupancy
Lower booking conversion
Higher CAC
### Base
Moderate supply
Moderate occupancy
Moderate CAC
10% take rate
### Aggressive
Rapid supply growth
Higher occupancy
Strong SEO
Strong partnerships
Experiences/transport adoption

# 75. Break-Even Formula
Approximate break-even booking volume:
Fixed Operating Costs
/
Contribution per Booking
=
Break-Even Bookings
Contribution per accommodation booking:
Booking Value × Commission
-
Payment Cost
-
Variable Support Cost
-
Refund/chargeback allowance
-
Acquisition Cost
This is more useful than simply calculating revenue.

# 76. Financial KPIs
Management dashboard should track:
GMV
Take Rate
Revenue
Contribution Margin
CAC
LTV
AOV
Bookings
Occupancy
Repeat Booking Rate
Host Retention
Cancellation Rate
Refund Rate
EBITDA
Cash Burn
Runway

# 77. Investment Gates
Do not commit heavily to statewide expansion until the following are demonstrated:
### Gate 1 — Supply
100+ credible properties.
### Gate 2 — Demand
Organic/paid demand producing real booking activity.
### Gate 3 — Conversion
Search-to-booking funnel is measurable.
### Gate 4 — Unit Economics
Contribution margin approaching positive territory.
### Gate 5 — Retention
Hosts remain active because bookings are being generated.
### Gate 6 — Operational Scalability
Verification and support processes can scale without proportional headcount growth.

# 78. Recommended Initial Financial Strategy
The company should minimize fixed costs during the validation stage.
Prioritize:
Product
Property acquisition
Verification
Customer support
SEO/content
Defer:
Large office
Large engineering team
Native mobile apps
Large advertising campaigns
Complex AI infrastructure
Statewide field operations
until product-market fit is demonstrated.

# 79. Proposed Product Organization
Initial:
Founder / CEO
 |
 ├── Product & Technology
 ├── Operations
 ├── Supply Acquisition
 └── Growth
Technology:
Technical Lead
 ├── Full-stack Engineer
 ├── Frontend Engineer
 └── QA/DevOps
Operations:
Operations Lead
 ├── Property Onboarding
 ├── Verification
 └── Customer Support

# 80. Recommended Build Strategy
Given the nature of this project, the development process should be:
Research
 ↓
Data Model
 ↓
UX Prototype
 ↓
Architecture
 ↓
Vertical Slice
 ↓
Pilot
 ↓
Measure
 ↓
Iterate
 ↓
Scale
Avoid building all modules simultaneously.
The first complete vertical slice should be:
Host
 ↓
Property
 ↓
Room
 ↓
Availability
 ↓
Tourist Search
 ↓
Booking
 ↓
Payment
 ↓
Host Notification
 ↓
Payout
 ↓
Review
If this works reliably, the core marketplace works.

# 81. Recommended MVP Release
The first production release should contain only:
### Tourist
Search
Destination pages
Property pages
Availability
Booking
Payment
Account
Reviews
### Host
Registration
Property
Rooms
Calendar
Pricing
Bookings
Revenue
### Admin
Verification
Property management
Booking management
User management
Payments
Reviews
Basic analytics
Everything else should wait.

# 82. Final Architecture Recommendation
The product should ultimately become a platform with five major layers:
MIZORAM TOURISM PLATFORM
 │
 ┌─────────────────────┼─────────────────────┐
 │ │ │
 DISCOVERY BOOKING SERVICES
 │ │ │
 Destinations Stays Transport
 Guides Payments Experiences
 SEO Reviews Packages
 │ │ │
 └─────────────────────┼─────────────────────┘
 │
 DATA PLATFORM
 │
 Analytics / Intelligence
 │
 AI PLATFORM
 │
 Planning / Recommendations
The most important architectural decision is to make property, inventory, booking and payment data highly structured from day one. This creates the foundation for future AI recommendations, demand forecasting, dynamic pricing and tourism intelligence.
The most important business decision is equally clear:
Do not optimize for registered homestays. Optimize for completed bookings, repeat tourists and host earnings.
That is what will determine whether this becomes a useful tourism website or a scalable tourism marketplace.
# Updated Target Architecture — Supabase + Vercel
The original architecture described Next.js + an API/BFF layer + PostgreSQL + Redis + object storage + a search engine. This updated architecture consolidates the MVP backend into Supabase.
Target:
Vercel → Next.js/React → Supabase SDK/API → Supabase PostgreSQL/Auth/Storage/Realtime/Edge Functions/PostGIS/pgvector/Cron/Queues.
Specialized external services:
Payment gateway → WhatsApp/SMS/email → Maps → AI/LLM.
Supabase's current architecture centers the platform on PostgreSQL with integrated Auth, Storage, Realtime and Functions. citeturn449551search10turn449551search2
## Revised High-Level Architecture
TOURIST / HOST / ADMIN
 │
 ▼
 VERCEL
 │
 ▼
 NEXT.JS / PWA
 │
 Supabase SDK
 │
 ▼
 ┌─────────────── SUPABASE ───────────────┐
 │ PostgreSQL + RLS │
 │ Auth │
 │ Storage │
 │ Realtime │
 │ Edge Functions │
 │ PostGIS / pgvector │
 │ Cron / Queues │
 └──────────────┬────────────────────────┘
 │
 ┌───────────┼───────────┐
 ▼ ▼ ▼
 Payments Messaging Maps
 │
 ▼
 AI/LLM APIs
## Repository / Folder Structure
mizoramstay/
├── src/
│ ├── app/
│ │ ├── (public)/
│ │ │ ├── page.tsx
│ │ │ ├── stays/[slug]/page.tsx
│ │ │ ├── destinations/[slug]/page.tsx
│ │ │ ├── search/page.tsx
│ │ │ └── travel-guides/[slug]/page.tsx
│ │ ├── booking/[id]/page.tsx
│ │ ├── account/
│ │ ├── host/
│ │ ├── admin/
│ │ └── api/v1/
│ ├── components/
│ │ ├── ui/
│ │ ├── public/
│ │ ├── booking/
│ │ ├── host/
│ │ └── admin/
│ ├── features/
│ │ ├── auth/
│ │ ├── properties/
│ │ ├── search/
│ │ ├── bookings/
│ │ ├── payments/
│ │ ├── reviews/
│ │ └── verification/
│ ├── lib/
│ │ ├── supabase/
│ │ │ ├── browser.ts
│ │ │ ├── server.ts
│ │ │ └── admin.ts
│ │ ├── booking/
│ │ ├── pricing/
│ │ └── validation/
│ └── types/
├── supabase/
│ ├── migrations/
│ ├── functions/
│ │ ├── _shared/
│ │ ├── create-booking/
│ │ ├── payment-webhook/
│ │ ├── cancel-booking/
│ │ └── send-notification/
│ ├── seed.sql
│ └── config.toml
├── tests/
│ ├── rls/
│ ├── booking/
│ └── e2e/
├── .env.example
└── README.md
## Actual Database Schema
The executable migration supplied with this package is the implementation baseline. It includes the original entities plus production-oriented payment events, refunds, attractions, experiences, transport, promotions, support and audit structures needed to support the roadmap.
## RLS Security Model
- Anonymous/public users: read published marketplace content only.
- Tourists: own profile, own bookings, permitted payment views, own wishlist and eligible reviews.
- Hosts: only their own host/property/room/media/document/inventory/pricing data and bookings associated with their properties.
- Admins: controlled administrative access.
- Payment, payout, refund, verification and audit mutations: server-side privileged workflows.
- Private verification documents: private Storage bucket + signed access only.
## API / Edge Function Specification
The API contract and Edge Function definitions are supplied as a separate machine-readable specification in API_EDGE_FUNCTIONS.md.
## Booking Transaction Model
Search → select room → server-side availability check → transactional inventory reservation/temporary hold → create booking → initiate payment → verify provider webhook → confirm booking → create payout record → notify parties.
On payment failure or hold expiry, inventory must be released. All payment events must be idempotent. The client must never be the source of truth for payment success or booking confirmation.
## UI/UX Infrastructure Binding
The original UX specification remains in force. Data sources now map to Supabase: public discovery from RLS-safe queries, host operations from authenticated RLS-protected operations, real-time operational status through Realtime where valuable, and privileged moderation/payment workflows through Edge Functions.
## Deployment & CI/CD
GitHub → Vercel preview deployment for pull requests → staging/preview validation → protected production deployment.
Supabase migrations are committed to the repository and promoted through the same environment lifecycle. Vercel's Supabase integration can synchronize environment variables and automatically handle suitable preview integrations. citeturn449551search3turn449551search4
## Roadmap — Revised
Phase 0 Discovery: 4–6 weeks.
Phase 1 Foundation: 3–4 weeks — Next.js/Vercel, Supabase projects, migrations, Auth, RLS, Storage, design system, CI/CD.
Phase 2 Property Marketplace: 4–6 weeks — host registration, property onboarding, verification, rooms, media, availability, pricing, search and SEO property pages.
Phase 3 Transactions: 4–6 weeks — transactional booking RPCs, Edge Functions, payment integration, webhook verification, cancellation/refunds, payout records, notifications.
Phase 4 Operations: 2–4 weeks — reviews, support, verification administration, analytics, Realtime and scheduled jobs.
Phase 5 Pilot: 4 weeks — 50–100 properties, operational validation and first real bookings.
Phase 6 Public launch: 4–8 weeks — SEO, partnerships, paid acquisition and travel-agent outreach.
Phase 7 Expansion — experiences, transport, packages and guides.
Phase 8 AI — itinerary generation, recommendations, demand forecasting and pricing recommendations.

| Metric | Year 1 | Year 2 | Year 3 |
| --- | --- | --- | --- |
| Active properties | 150 | 400 | 800 |
| Rooms/property | 3 | 3 | 3 |
| Platform occupancy | 12% | 18% | 24% |
| Average nightly rate | ₹1,600 | ₹1,700 | ₹1,800 |
| Accommodation take rate | 10% | 10% | 10% |
| Experience GMV / accommodation GMV | 15% | 15% | 15% |
| Transport GMV / accommodation GMV | 10% | 10% | 10% |
