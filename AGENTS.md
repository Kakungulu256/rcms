# Software Requirements Specification (SRS)

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements for a **Rental Collection Management System (RCMS)**. The system is intended to manage tenants, houses, rent collection, arrears allocation, and expense tracking, while supporting migration of historical paper-based records into a digital system.

### 1.2 Scope

The system will:

* Register houses and assign rental rates
* Register tenants and assign them to houses
* Track rent payments (cash and bank deposits)
* Automatically allocate payments to arrears by month
* Indicate rent payment status per tenant (Green / Orange / Red)
* Record general and maintenance expenses
* Support back-capture of historical data

The frontend will be built using **React**, while **Appwrite** will be used for authentication, database, and server-side functions.

### 1.3 Definitions

* **Tenant**: A person renting a house
* **House**: A rentable unit with an assigned rent amount
* **Arrears**: Unpaid rent from previous months
* **General Expense**: Non-house-specific operational costs
* **Maintenance Expense**: House-specific repair or improvement costs

---

## 2. Overall Description

### 2.1 User Roles

* **Admin**: Full system access, configuration, and reporting
* **Clerk**: Tenant registration, rent collection, expense recording
* **Viewer (optional)**: Read-only access to reports

### 2.2 Operating Environment

* Web application (desktop-first)
* Modern browsers (Chrome, Edge, Firefox)
* Appwrite Cloud or Self-hosted Appwrite

### 2.3 Design Constraints

* React + Vite frontend
* Appwrite for Auth, Database, Storage, and Functions
* Data integrity must support historical backdating

---

## 3. System Features & Functional Requirements

### 3.1 House Management

**Description:** Manage rental houses and their rates.

**Requirements:**

* Create, update, deactivate houses
* Assign a monthly rent amount to each house
* Track maintenance expenses per house

**Data Fields:**

* House ID
* House Name / Code
* Monthly Rent Amount
* Status (Occupied / Vacant)

---

### 3.2 Tenant Management

**Description:** Register tenants and assign them to houses.

**Requirements:**

* Register tenant personal details
* Assign tenant to exactly one house at a time
* Capture move-in date and optional move-out date
* Support historical tenants (already moved out)

**Data Fields:**

* Tenant ID
* Full Name
* Phone Number
* Assigned House ID
* Rent Rate (derived from house)
* Move-in Date
* Move-out Date (nullable)
* Status (Active / Inactive)

---

### 3.3 Rent Collection

**Description:** Record rent payments and automatically allocate them.

**Requirements:**

* Record rent payments via:

  * Cash
  * Bank Deposit
* Capture actual payment date (not system date only)
* Allow backdated entries for historical data
* Allocate payments to oldest unpaid months first
* Maintain an immutable payment history

**Payment Allocation Rules:**

1. Identify tenant’s monthly rent from assigned house
2. If tenant has arrears:

   * Apply payment to earliest unpaid month(s)
3. If payment exceeds arrears:

   * Apply remaining balance to current or future months
4. Store allocation breakdown per month

**Data Fields:**

* Payment ID
* Tenant ID
* Amount Paid
* Payment Method (Cash / Bank)
* Payment Date
* Recorded By
* Allocation Metadata (Month → Amount)

---

### 3.4 Rent Status Visualization

**Description:** Display tenant payment status per current month.

**Rules (evaluated when viewing tenant details):**

* **Green**: Full rent for current month paid
* **Orange**: Partial payment for current month
* **Red**: No payment for current month

**Notes:**

* Status is computed dynamically
* Status is visible when viewing tenant profile, not globally

---

### 3.5 Expense Management

#### 3.5.1 General Expenses

**Description:** Track operational expenses not tied to a specific house.

**Examples:**

* Gateman salary
* Caretaker salary
* Rubbish collection

**Requirements:**

* Record expense amount
* Capture source of funds:

  * Rent (Cash)
  * External receipt
* Support backdated entry

**Data Fields:**

* Expense ID
* Category (General)
* Description
* Amount
* Source (Rent Cash / External)
* Expense Date

---

#### 3.5.2 Maintenance Expenses

**Description:** Track house-specific maintenance costs.

**Examples:**

* Electrical repairs
* Plumbing
* Painting
* Construction

**Requirements:**

* Associate expense with a house
* Record maintenance type
* Capture funding source

**Data Fields:**

* Expense ID
* Category (Maintenance)
* House ID
* Description
* Amount
* Source (Rent Cash / External)
* Expense Date

---

### 3.6 Historical Data Migration

**Description:** Support capturing data from paper records.

**Requirements:**

* Allow manual entry of historical tenants, payments, and expenses
* Allow import via Excel (.xlsx)
* Preserve original transaction dates
* Flag migrated records for audit purposes

---

## 4. Non-Functional Requirements

### 4.1 Security

* Appwrite authentication
* Role-based access control
* Audit logging for payments and expenses

### 4.2 Performance

* Payment allocation should complete within < 1 second per transaction
* Support at least 1,000 tenants without degradation

### 4.3 Data Integrity

* Payments cannot be deleted, only reversed
* Rent allocation must be deterministic and reproducible

### 4.4 Usability

* Simple forms optimized for clerks
* Clear visual indicators (Green / Orange / Red)

---

## 5. User Interface (UI) and User Experience (UX) Requirements

### 5.1 General UI Principles

* Clean, minimal, and form-driven interface optimized for daily clerical use
* Desktop-first design with responsive behavior for tablets
* Consistent color usage and iconography
* Clear visual feedback after every action (success, error, warning)

### 5.2 Navigation Structure

* Top-level navigation:

  * Dashboard
  * Houses
  * Tenants
  * Payments
  * Expenses
  * Reports
  * Settings (Admin only)

* Breadcrumb navigation for deep views (e.g., Tenants → John Doe → Payments)

### 5.3 Dashboard UI

**Purpose:** Provide a quick operational overview.

**Widgets:**

* Total houses / occupied / vacant
* Total rent expected (current month)
* Total rent collected (current month)
* Outstanding arrears
* Expense summary (General vs Maintenance)

**UX Notes:**

* Summary cards with clear numeric emphasis
* No per-tenant payment status shown here (status is tenant-specific)

---

### 5.4 House Management UI

**Screens:**

* House List View
* House Detail View

**House List View:**

* Table layout
* Columns: House Code, Rent Amount, Status, Current Tenant
* Actions: View, Edit, Deactivate

**House Detail View:**

* House information summary
* Linked maintenance expenses
* Historical tenant list

---

### 5.5 Tenant Management UI

#### 5.5.1 Tenant List View

* Searchable and sortable table
* Columns: Tenant Name, House, Move-in Date, Status
* No color indicators here

#### 5.5.2 Tenant Detail View (Core Screen)

**Purpose:** Central operational screen for rent tracking.

**Sections:**

1. Tenant Information Panel
2. Assigned House & Rent Rate
3. Current Month Rent Status Indicator:

   * Green: Fully paid
   * Orange: Partially paid
   * Red: Not paid
4. Arrears Summary (by month)
5. Payment History Table

**UX Notes:**

* Status indicator is visually prominent
* Arrears are displayed chronologically (oldest first)

---

### 5.6 Rent Payment Entry UI

**Payment Form Requirements:**

* Tenant selection (searchable dropdown)
* Amount paid
* Payment method (Cash / Bank Deposit)
* Payment date (editable for back-capture)
* Optional notes/reference number

**UX Notes:**

* Show preview of how payment will be allocated before submission
* Confirmation modal before final save

---

### 5.7 Expense Management UI

#### 5.7.1 General Expenses UI

* Simple form:

  * Description
  * Amount
  * Source of funds (Rent Cash / External)
  * Expense date

#### 5.7.2 Maintenance Expenses UI

* Additional required field: House selection
* Maintenance type dropdown (Electrical, Plumbing, Painting, etc.)

**UX Notes:**

* Expense category selection controls visible fields

---

### 5.8 Historical Data Capture UI

* Dedicated "Migration Mode"
* Clear labeling: "Historical Record"
* Support for:

  * Manual entry
  * Excel (.xlsx) import

**UX Notes:**

* Date fields are mandatory
* Imported records are read-only after confirmation

---

### 5.9 Feedback & Error Handling

* Toast notifications for success and errors
* Inline form validation messages
* System warnings for:

  * Overpayments
  * Payments on inactive tenants

---

### 5.10 Accessibility & Usability

* Keyboard navigable forms
* Clear focus states
* Readable color contrast for status indicators

---

## 6. Technical Architecture

### 5.1 Frontend

* React 18 + Vite
* React Router
* React Hook Form
* TailwindCSS
* date-fns for date handling
* xlsx for imports
* jsPDF for reports

### 5.2 Backend (Appwrite)

**Services Used:**

* Auth: User authentication
* Database: Tenants, Houses, Payments, Expenses
* Functions: Payment allocation logic, reports

### 5.3 Appwrite Functions

**Key Functions:**

* allocateRentPayment()
* computeTenantStatus()
* migrateHistoricalData()

Node environment:

* node-appwrite SDK

---

## 7. Assumptions & Future Enhancements

### Assumptions

* One tenant occupies one house at a time
* Rent rate changes apply only to new periods

### Future Enhancements

* Multi-property support
* Mobile-first UI
* Automated bank statement reconciliation
* Financial summaries and charts

---

## 7. Approval

This SRS serves as the baseline for development and implementation of the Rental Collection Management System.
