## Ingestion stage summary

During this stage, I successfully ingested external data into Azure Storage using an Azure Container App Job (CAJ). The job retrieves a dataset from an external API and processes it 
within a managed Azure environment.

Because this workload is acting as an API client rather than exposing its own API endpoint, threats such as BOLA, DDoS, and API injection are not the primary risks in this stage.
Instead, the main security priorities are protecting credentials, applying least-privilege access, and ensuring the ingestion script does not expose secrets.

To achieve this, I used a combination of Managed Identity and Azure Key Vault. The API credentials are stored securely in Key Vault, while the Container App Job is assigned a managed 
identity with permission to retrieve those secrets and write to Azure Storage. This removes the need to hardcode credentials and reduces the risk of secret exposure.

Using a Container App Job also reduces operational overhead compared to running a VM. Azure manages the environment, which lowers cost and reduces the infrastructure attack surface 
I am directly responsible for. The tradeoff is reduced network control, since the default Azure-managed environment does not provide the same flexibility as a custom 
VNet-integrated setup.

A stronger next step would be to split this process into two jobs: one job with internet access to retrieve external data, and a second internal job responsible 
for validation, parsing, sanitisation, and writing approved data into private storage. This would improve separation of duties and provide tighter control over untrusted 
data before it reaches core Azure resources.

Future refinements include custom VNet integration, private endpoints for critical services such as Storage and Key Vault, and tighter access control around managed identities 
and secret access.
