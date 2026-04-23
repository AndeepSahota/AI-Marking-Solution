# Secure Web Upload Platform – Security Design

## Overview

This document outlines the security architecture and threat model for the teacher upload web application.

The system allows teachers to upload student work through a web interface. Uploaded files are sent through an API layer and processed by a backend service before being stored.

The purpose of this document is to:

- Identify critical assets within the system  
- Identify attack surfaces and trust boundaries  
- Identify potential threats to system components  
- Define security controls before implementation  

The design focuses mainly on:

- Web security  
- API security  
- Identity and authentication  
- Secure storage  

This document primarily covers the **Identify, Protect, and Detect** phases of the security model.

---

# System Architecture

## High-Level Flow

User Browser
      │
Internet
      │
      ------Untrusted
WAF / Application Gateway
      │
Frontend Web App
      │-----Semi trusted
API Management
      │-----Trusted
Backend API (container)
      │-----Fully Trusted
Storage / Database


## Security Zones

| Zone | Trust Level |
|-----|-------------|
| Internet | Untrusted |
| Frontend Web App | Semi-trusted |
| API Gateway | Trusted |
| Backend API | Trusted |
| Storage | Highly trusted |

---

# Core Assets

The system must protect the following assets:

- User identities (teachers)
- Authentication tokens (JWT)
- Uploaded student work
- Backend API endpoints
- Stored files and images
- Authentication infrastructure

These assets exist across several components and must be protected through layered security controls.

---

# Component Responsibilities

## WAF / Application Gateway

The WAF acts as the **first defensive layer exposed to the internet**.

### Responsibilities

- Inspect incoming HTTP/HTTPS traffic
- Filter malicious Layer 7 requests
- Protect against common web attacks
- Rate limit abusive traffic
- Forward legitimate requests to the application

### Security Considerations

- Secure rule configuration
- Regular rule tuning to minimise false positives
- High availability and failover
- Logging and monitoring of incoming traffic

---

## Frontend Web Application

The frontend provides the **user interface for authentication and file uploads**.

Because it runs in the browser, it must be treated as an **untrusted environment**.

### Responsibilities

- Authenticate users
- Allow teachers to upload files
- Send API requests to backend services

### Security Principles

- No secrets stored in frontend code
- No sensitive business logic in client-side scripts
- All input validation must also be enforced server-side

---

## API Management Gateway

API Management acts as the **controlled entry point for backend APIs**.

### Responsibilities

- Validate authentication tokens
- Enforce rate limiting
- Validate request structure
- Route requests to backend services
- Log API activity

This layer ensures backend services are not directly exposed to the internet.

---

## Backend API

The backend API contains the **core application logic**.

### Responsibilities

- Process authenticated API requests
- Validate uploaded data
- Interact with storage systems
- Enforce authorization rules

### Security Considerations

- Strict input validation
- Protection against injection attacks
- Secure file handling
- Least privilege access to storage

---

## Storage

Storage is the **final destination for uploaded files**.

### Responsibilities

- Store uploaded student work
- Ensure data confidentiality and integrity
- Restrict access to authorised services

### Security Requirements

- Private network access
- Identity-based access control
- Logging and monitoring

---

## Identity Providers

Two identity systems are used in the architecture.

### Azure Active Directory

Handles **user authentication**.

Responsibilities include:

- Authenticating teacher accounts
- Issuing JWT tokens
- Enforcing multi-factor authentication

### Managed Identity + Azure Key Vault

Used for **service-to-service authentication**.

Responsibilities include:

- Providing secure access between services
- Storing secrets and keys
- Enforcing least privilege access

---

# Threat Identification

## WAF

The WAF is a defensive control, but poor configuration or insufficient rule coverage can allow malicious traffic through.

### Threats

- Obfuscated HTTP payloads
- Evasion of pattern-based detection
- Misconfigured WAF rules
- False positives impacting availability
- False negatives allowing malicious traffic

### Mitigations

- Managed OWASP rule sets
- Regular rule tuning
- Continuous logging and monitoring
- SIEM integration
- Rate limiting and anomaly detection

---

## Frontend Web Application

The frontend is the **primary entry point into the system**.

### Threats

- Distributed denial-of-service attacks
- Man-in-the-middle interception
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Exposure of sensitive information in frontend code
- Malicious file upload attempts

### Mitigations

- HTTPS enforcement
- HSTS configuration
- Rate limiting at the WAF
- Secure frontend development practices
- Server-side validation of uploads
- File type and size restrictions

---

## API Management / Backend API

### Threats

- Stolen JWT tokens used to impersonate users
- Injection attacks
- Abuse of API endpoints
- Resource exhaustion attacks
- Exposure of sensitive data in JWT payloads

### Mitigations

- Short-lived JWT tokens
- Strong authentication policies
- Request schema validation
- API rate limiting
- Input sanitisation
- Strict authorization checks

---

## Storage

### Threats

- Unauthorised access to stored data
- Insider data exfiltration
- Unauthorised modification of files
- Excessive storage permissions

### Mitigations

- Least privilege IAM roles
- Network isolation of storage
- Backend-only access paths
- Storage access logging
- Data integrity verification

---

## Identity Infrastructure

### Threats

- Credential brute-force attacks
- JWT replay attacks
- Private key compromise
- Secret leakage
- Misconfigured permissions

### Mitigations

- Multi-factor authentication
- JWT expiration policies
- Key rotation
- Secure secret storage in Key Vault
- Privileged access controls

---

# Detection and Monitoring

Threat detection will rely on logs from several system components.

### Log Sources

- WAF logs
- API management logs
- Authentication logs
- Storage access logs
- Application logs

All logs will be aggregated into a **centralised SIEM platform**.

Monitoring should focus on detecting:

- Authentication anomalies
- Repeated blocked requests
- API abuse patterns
- Abnormal file upload behaviour
- Unusual storage access patterns

---

# Security Design Summary

The system applies **layered security controls across the architecture**.

Key protections include:

- Web protection through a WAF
- API protection through API management
- Identity protection through Azure AD
- Secure service authentication using managed identities
- Data protection through restricted storage access

Security principles applied throughout the design:

- Defence in depth
- Least privilege
- Secure input validation
- Short-lived authentication tokens
- Centralised monitoring
