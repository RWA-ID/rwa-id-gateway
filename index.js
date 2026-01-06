require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 5000;

const LINEA_RPC_URL = (process.env.LINEA_RPC_URL || '').trim();
const RWA_ID_REGISTRY = (process.env.RWA_ID_REGISTRY || '').trim();
const GATEWAY_SIGNER_PRIVATE_KEY = (process.env.GATEWAY_SIGNER_PRIVATE_KEY || '').trim();

if (!LINEA_RPC_URL || !RWA_ID_REGISTRY || !GATEWAY_SIGNER_PRIVATE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(LINEA_RPC_URL);
const signer = new ethers.Wallet(GATEWAY_SIGNER_PRIVATE_KEY);
console.log("GATEWAY SIGNER ADDRESS:", signer.address);

const REGISTRY_ABI = [
  'function projectIdBySlugHash(bytes32) view returns (uint256)',
  'function nameNodeFromHash(uint256,bytes32) view returns (bytes32)',
  'function nodeAddr(bytes32) view returns (address)'
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
  const addr = await registry.nodeAddr(node);

  const messageHash = ethers.solidityPackedKeccak256(
    ['address', 'bytes32', 'address'],
    [RWA_ID_REGISTRY, node, addr]
  );

  const sig = signer.signingKey.sign(messageHash);
  const signature = ethers.concat([sig.r, sig.s, ethers.toBeHex(sig.v, 1)]);

  return {
    name: fullName,
    projectId: projectId.toString(),
    nameHash,
    node,
    address: addr,
    messageHash,
    signature
  };
}

app.get('/health', (req, res) => {
  res.json({ ok: true, registry: RWA_ID_REGISTRY, signer: signer.address });
});

app.get('/resolve', async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) {
      return res.status(400).json({ error: 'Missing name parameter' });
    }

    const result = await resolveName(name);
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('Resolve error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/:sender/:data.json', async (req, res) => {
  try {
    const { sender, data } = req.params;
    
    if (!data.startsWith('0x')) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const dataBytes = ethers.getBytes(data);
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const [dnsNameBytes, callData] = abiCoder.decode(['bytes', 'bytes'], dataBytes);

    const labels = parseDnsName(dnsNameBytes);
    
    if (labels.length < 3 || labels[labels.length - 2] !== 'rwa-id' || labels[labels.length - 1] !== 'eth') {
      return res.status(400).json({ error: 'Invalid DNS name: must end with .rwa-id.eth' });
    }

    const fullName = labels.join('.').toLowerCase();
    const label = labels[0].toLowerCase();
    const slug = labels[1].toLowerCase();

    const slugHash = ethers.keccak256(ethers.toUtf8Bytes(slug));
    const nameHash = ethers.keccak256(ethers.toUtf8Bytes(label));

    const projectId = await registry.projectIdBySlugHash(slugHash);
    
    if (projectId === 0n) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const node = await registry.nameNodeFromHash(projectId, nameHash);
    const addr = await registry.nodeAddr(node);

    const messageHash = ethers.solidityPackedKeccak256(
      ['address', 'bytes32', 'address'],
      [RWA_ID_REGISTRY, node, addr]
    );

    const sig = signer.signingKey.sign(messageHash);
    const signature = ethers.concat([sig.r, sig.s, ethers.toBeHex(sig.v, 1)]);

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

app.get('/signer', (req, res) => {
  res.json({ signerAddress: signer.address });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`RWA-ID Gateway running on port ${PORT}`);
  console.log(`Registry: ${RWA_ID_REGISTRY}`);
  console.log(`RPC URL: ${LINEA_RPC_URL}`);
  console.log(`Signer Address: ${signer.address}`);
});
