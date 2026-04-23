# Teacher AI - Secure AI Marking Platform (Work in Progress)

## Overview
Teacher AI is a multi-phase project to design a secure, enterprise-style platform for AI-assisted marking in secondary education. The goal is to support the marking of English responses against a rubric while building the surrounding infrastructure as if it were being delivered to schools as a B2B SaaS offering.

Rather than focusing only on the model itself, this project approaches AI delivery from a consultancy perspective: understanding the business problem, designing a secure target architecture, and building the supporting cloud, identity, networking, and data foundations required to deploy the solution safely.

## Problem
Teachers spend a significant amount of time marking written work, and marking can vary between individuals. This project explores how an AI-based system could reduce workload, improve feedback speed, and increase consistency, while still being deployed in a way that meets real-world security and operational expectations.

## My Focus
My workstream focuses on the infrastructure and security side of the platform. This includes:
- secure cloud architecture in Azure
- data ingestion design
- identity and access control
- secure storage and secret handling
- network design for customer-to-cloud connectivity
- preparing the platform for future enterprise-style deployment

## Architecture Direction
The wider architecture treats the school or customer environment as a separate, secured environment that connects into Azure-based services. This reflects a realistic deployment model where sensitive student data, user access, and model interaction must be protected across both on-premises and cloud components.

The project has therefore been designed around:
- hybrid connectivity between customer environments and Azure
- segmented network design
- identity-led access control
- secure movement of data at rest, in transit, and in use
- separation of training, ingestion, and application-serving concerns

## Work Completed So Far

### 1. Defined the secure AI delivery architecture
I mapped out the core workstreams required to deliver the platform securely, including:
- data engineering and security
- Active Directory and IAM
- network architecture and secure design
- firewall engineering
- cloud-based model training and hosting

This helped position the project not as a simple AI demo, but as a realistic end-to-end solution.

### 2. Designed the data ingestion layer
I planned the ingestion workflow to pull datasets from approved external sources, process them in Azure, and store them for later training use.

The ingestion component is being designed around Azure Container Apps Jobs rather than relying on a traditional always-on VM. This gives a cleaner and more cloud-native pattern for scheduled or event-driven ingestion work.

### 3. Containerised the ingestion workload
I used Docker to package the ingestion code and its dependencies into a portable image, then pushed that image into Azure Container Registry (ACR). This establishes a deployment path that is closer to how modern cloud workloads are delivered in production.

### 4. Built the storage foundation
I set up Azure storage components to support raw data landing and future processing, including Data Lake-style storage structure for datasets and downstream use.

As part of this, I considered both functionality and secure access design, including how ingestion services would upload data and how storage would later support training workflows.

### 5. Explored private networking and secure access paths
I tested a more secure design using private endpoints, private DNS, and a VM inside the virtual network to validate storage access without exposing services publicly.

This was useful for understanding how the production design should operate, even though I later relaxed some access settings temporarily to prioritise build speed and functional testing in the current phase.

### 6. Implemented a stronger identity model
A major design decision was to avoid embedding credentials inside code or configuration. Instead, I moved toward using Azure Managed Identity and Azure Key Vault.

This means the ingestion workload can authenticate to Azure services using platform-issued tokens rather than stored secrets, while external API secrets can be kept in Key Vault and referenced securely at runtime.

### 7. Refined access control and registry permissions
I also worked through Azure Container Registry access considerations, including the difference between ABAC and RBAC in this setup, so that image access and deployment permissions align more closely with a manageable enterprise model.

## Security Principles Applied
This project has been shaped by a few core security principles:
- least privilege access
- removal of hardcoded secrets
- preference for identity-based authentication
- layered network controls
- clear separation between development pragmatism and production-grade design
- secure handling of data at rest, in transit, and during processing

## Consultancy Lens
What makes this project relevant from a consultancy perspective is that it is not just about building a technical solution. It is about translating a business problem into a secure architecture, making design trade-offs between ideal security and delivery practicality, and building with future deployment, maintainability, and customer environments in mind.

This project reflects how I approach technical consulting work:
- start with the operational problem
- identify the systems and trust boundaries involved
- choose secure-by-design patterns where possible
- document trade-offs clearly
- build iteratively while keeping the long-term architecture in view

## Current Status
This project is still in progress. The data ingestion and identity foundations are actively being built, and the wider architecture continues to evolve alongside the model development work.

The current phase has focused on securing how data is collected, authenticated, stored, and prepared in Azure so that later model training and application delivery sit on stronger foundations.

## Technologies
Azure, Azure Container Apps Jobs, Azure Container Registry, Azure Storage, Data Lake concepts, Docker, Managed Identity, Azure Key Vault, RBAC, private endpoints, private DNS, virtual networking, API security, Active Directory, firewall and hybrid architecture concepts
