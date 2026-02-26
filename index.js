require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 5000;

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
});

const ETH_RPC_URL = (process.env.ETH_RPC_URL || '').trim();
const RWA_ID_REGISTRY = (process.env.RWA_ID_REGISTRY || '0xD0B565C7134bDB16Fc3b8A9Cb5fdA003C37930c2').trim();
const GATEWAY_SIGNER_PRIVATE_KEY = (process.env.GATEWAY_SIGNER_PRIVATE_KEY || '').trim();

if (!ETH_RPC_URL || !GATEWAY_SIGNER_PRIVATE_KEY) {
  console.error('Missing required environment variables: ETH_RPC_URL, GATEWAY_SIGNER_PRIVATE_KEY');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(ETH_RPC_URL);
const signer = new ethers.Wallet(GATEWAY_SIGNER_PRIVATE_KEY);
console.log('GATEWAY SIGNER ADDRESS:', signer.address);

const REGISTRY_ABI = [
  'function projectIdBySlugHash(bytes32) view returns (uint256)',
  'function nameNodeFromHash(uint256,bytes32) view returns (bytes32)',
  'function resolveAddr(bytes32) view returns (address)',
];

const registry = new ethers.Contract(RWA_ID_REGISTRY, REGISTRY_ABI, provider);

function parseDnsName(dnsNameBytes) {
  const bytes = ethers.getBytes(dnsNameBytes);
  const labels = [];
  let i = 0;
  while (i < bytes.length) {
    const len = bytes[i];
    if (len === 0) break;
    i++;
    const label = new TextDecoder().decode(bytes.slice(i, i + len));
    labels.push(label);
    i += len;
  }
  return labels;
}

async function resolveName(fullName) {
  const parts = fullName.trim().toLowerCase().split('.');

  if (parts.length < 3 || parts[parts.length - 2] !== 'rwa-id' || parts[parts.length - 1] !== 'eth') {
    return { error: 'Invalid name: must end with .rwa-id.eth', status: 400 };
  }

  const label = parts[0];
  const slug = parts[1];

  const slugHash = ethers.keccak256(ethers.toUtf8Bytes(slug));
  const nameHash = ethers.keccak256(ethers.toUtf8Bytes(label));

  const projectId = await registry.projectIdBySlugHash(slugHash);
  if (projectId === 0n) {
    return { error: 'Project not found', status: 404 };
  }

  const node = await registry.nameNodeFromHash(projectId, nameHash);
  const addr = await registry.resolveAddr(node);

  const messageHash = ethers.solidityPackedKeccak256(
    ['address', 'bytes32', 'address'],
    [RWA_ID_REGISTRY, node, addr]
  );

  const signature = signer.signingKey.sign(messageHash).serialized;

  return { name: fullName, projectId: projectId.toString(), nameHash, node, address: addr, messageHash, signature };
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'rwaid-gateway', registry: RWA_ID_REGISTRY, signer: signer.address });
});

app.get('/signer', (req, res) => {
  res.json({ signerAddress: signer.address });
});

app.get('/resolve', async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: 'Missing ?name=' });
    const result = await resolveName(name);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (error) {
    console.error('Resolve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// EIP-3668 CCIP-Read endpoint: /{sender}/{data}.json
// {data} is hex-encoded abi.encode(bytes dnsName, bytes addrCalldata) — no 0x prefix per spec
app.get('/:sender/:data.json', async (req, res) => {
  try {
    const { data } = req.params;

    // EIP-3668 sends data without 0x prefix — normalise
    const dataHex = data.startsWith('0x') ? data : '0x' + data;

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const [dnsNameBytes] = abiCoder.decode(['bytes', 'bytes'], dataHex);

    const labels = parseDnsName(dnsNameBytes);

    if (labels.length < 3 || labels[labels.length - 2] !== 'rwa-id' || labels[labels.length - 1] !== 'eth') {
      return res.status(400).json({ error: 'Invalid DNS name: must end with .rwa-id.eth' });
    }

    const label = labels[0].toLowerCase();
    const slug = labels[1].toLowerCase();

    const slugHash = ethers.keccak256(ethers.toUtf8Bytes(slug));
    const nameHash = ethers.keccak256(ethers.toUtf8Bytes(label));

    const projectId = await registry.projectIdBySlugHash(slugHash);
    if (projectId === 0n) return res.status(404).json({ error: 'Project not found' });

    const node = await registry.nameNodeFromHash(projectId, nameHash);
    const addr = await registry.resolveAddr(node);

    const messageHash = ethers.solidityPackedKeccak256(
      ['address', 'bytes32', 'address'],
      [RWA_ID_REGISTRY, node, addr]
    );

    const signature = signer.signingKey.sign(messageHash).serialized;

    const encoded = abiCoder.encode(
      ['bytes32', 'address', 'bytes32', 'bytes'],
      [node, addr, messageHash, signature]
    );

    res.json({ data: encoded });
  } catch (error) {
    console.error('CCIP-Read error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`RWA-ID Gateway v2 running on port ${PORT}`);
  console.log(`Registry: ${RWA_ID_REGISTRY}`);
  console.log(`Signer:   ${signer.address}`);
});
