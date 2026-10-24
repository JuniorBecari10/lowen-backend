import { supabaseAdminClient } from "../../infra/supabase.js";
import { env } from "../../config/env.js";
import { Errors } from "../../shared/errors.js";
import { Company } from "../company/company.service.js";
import { encrypt, decrypt, EncryptedEnvelope } from "../../infra/crypto.js";
import forge from "node-forge";

export interface CertificateMetadata {
  id: string;
  subjectName: string | null;
  taxId: string | null;
  issuer: string | null;
  serialNumber: string | null;
  fingerprintSha256: string;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
  validationResult: Record<string, unknown> | null;
  revocationStatus: string | null;
  validatedAt: string | null;
  createdAt: string;
}

export interface ParsedCertificate {
  subjectName: string;
  taxId: string;
  issuer: string;
  serialNumber: string;
  fingerprintSha256: string;
  validFrom: Date;
  validTo: Date;
  pfxBuffer: Buffer;
  pfxPassword: string;
}

export interface PfxEnvelope extends EncryptedEnvelope {
  // Extends EncryptedEnvelope from crypto.ts
}

/**
 * Busca metadados do certificado ativo da empresa (sem dados sensíveis).
 */
export async function getCertificateMetadata(
  company: Company,
): Promise<CertificateMetadata | null> {
  const { data, error } = await supabaseAdminClient
    .from("certificates")
    .select(
      `id, subject_name, tax_id, issuer, serial_number, fingerprint_sha256,
       valid_from, valid_to, is_active, validation_result, revocation_status,
       validated_at, created_at`,
    )
    .eq("company_id", company.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw Errors.upstreamUnavailable("Falha ao consultar certificado.");
  }
  return data as CertificateMetadata | null;
}

/**
 * Parseia e valida PKCS#12 (A1) com node-forge.
 * Valida: CNPJ do subject, validade, par chave-certificado.
 */
export async function parseAndValidatePkcs12(
  pfxBuffer: Buffer,
  password: string,
): Promise<ParsedCertificate> {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(pfxBuffer.toString("binary")),
      password,
    );
  } catch (e) {
    throw Errors.unprocessable("Senha do certificado inválida ou arquivo corrompido.");
  }

  // Extrair certificado e chave privada
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });

  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];

  if (!certBag || !certBag.cert) {
    throw Errors.unprocessable("Certificado não encontrado no PFX.");
  }
  if (!keyBag || !keyBag.key) {
    throw Errors.unprocessable("Chave privada não encontrada no PFX.");
  }

  const cert = certBag.cert;
  const privateKey = keyBag.key;

  // Validar par chave-certificado
  const certPublicKey = cert.publicKey;
  const keyPublicKey = forge.pki.rsa.setPublicKey(
    privateKey.n,
    privateKey.e,
  );
  const certModulus = certPublicKey.n.toString(16);
  const keyModulus = keyPublicKey.n.toString(16);
  if (certModulus !== keyModulus) {
    throw Errors.unprocessable("Chave privada não corresponde ao certificado.");
  }

  // Extrair subject CNPJ
  const subject = cert.subject;
  const cnAttrs = subject.getField("CN");
  const subjectName = cnAttrs?.[0]?.value ?? "";
  // CNPJ pode vir no CN (ex: "12345678000195 - EMPRESA LTDA") ou em OID 2.5.4.97
  let taxId = "";
  const cnpjMatch = subjectName.match(/([0-9]{14})/);
  if (cnpjMatch) {
    taxId = cnpjMatch[1];
  } else {
    // Tentar OID 2.5.4.97 (serialNumber no subject)
    const snAttrs = subject.getField("serialNumber");
    if (snAttrs?.[0]?.value) {
      const sn = snAttrs[0].value;
      const snMatch = sn.match(/([0-9]{14})/);
      if (snMatch) taxId = snMatch[1];
    }
  }

  if (!taxId || taxId.length !== 14) {
    throw Errors.unprocessable("CNPJ não encontrado ou inválido no certificado.");
  }

  // Validar validade
  const now = new Date();
  const validFrom = cert.validity.notBefore;
  const validTo = cert.validity.notAfter;
  if (now < validFrom || now > validTo) {
    throw Errors.unprocessable("Certificado fora do período de validade.");
  }

  // Fingerprint SHA-256
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fingerprint = forge.md.sha256.create().update(der).digest().toHex();

  // Serial number
  const serialNumber = cert.serialNumber;

  // Issuer
  const issuer = cert.issuer.attributes
    .map((a) => `${a.shortName}=${a.value}`)
    .join(", ");

  return {
    subjectName,
    taxId,
    issuer,
    serialNumber,
    fingerprintSha256: fingerprint,
    validFrom,
    validTo,
    pfxBuffer,
    pfxPassword: password,
  };
}

/**
 * Salva o PFX cifrado no Storage e persiste metadados na tabela.
 */
export async function saveCertificate(
  company: Company,
  parsed: ParsedCertificate,
): Promise<string> {
  const certificateId = crypto.randomUUID();
  const aadPfx = `${company.id}:${certificateId}:pfx`;
  const aadPassword = `${company.id}:${certificateId}:password`;

  // Cifrar PFX e senha
  const pfxEnvelope = encrypt(parsed.pfxBuffer, aadPfx);
  const passwordEnvelope = encrypt(Buffer.from(parsed.pfxPassword, "utf8"), aadPassword);

  // Upload do PFX cifrado para Storage
  const storagePath = `${company.id}/${certificateId}.pfx.enc`;
  const { error: uploadError } = await supabaseAdminClient.storage
    .from("certificates")
    .upload(storagePath, pfxEnvelope.ciphertext, {
      contentType: "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw Errors.upstreamUnavailable(`Falha ao armazenar certificado: ${uploadError.message}`);
  }

  // Inserir na tabela certificates
  // Guardamos o envelope do PFX no validation_result (jsonb) já que a migration
  // não tem colunas separadas para IV/tag do PFX
  const validationResult = {
    subjectCnpjMatch: true,
    validityCheck: "VALID",
    keyPairMatch: true,
    validatedAt: new Date().toISOString(),
    pfxEnvelope: {
      iv: Buffer.from(pfxEnvelope.iv).toString("base64"),
      tag: Buffer.from(pfxEnvelope.tag).toString("base64"),
      keyVersion: pfxEnvelope.keyVersion,
    },
  };

  const { error: insertError } = await supabaseAdminClient
    .from("certificates")
    .insert({
      id: certificateId,
      company_id: company.id,
      subject_name: parsed.subjectName,
      tax_id: parsed.taxId,
      issuer: parsed.issuer,
      serial_number: parsed.serialNumber,
      fingerprint_sha256: parsed.fingerprintSha256,
      valid_from: parsed.validFrom.toISOString(),
      valid_to: parsed.validTo.toISOString(),
      is_active: true,
      validation_result: validationResult,
      revocation_status: "UNKNOWN",
      validated_at: new Date().toISOString(),
      storage_path: storagePath,
      password_ciphertext: passwordEnvelope.ciphertext,
      password_iv: passwordEnvelope.iv,
      password_tag: passwordEnvelope.tag,
      key_version: passwordEnvelope.keyVersion,
    });

  if (insertError) {
    // Tentar limpar o arquivo do Storage se a inserção falhar
    await supabaseAdminClient.storage.from("certificates").remove([storagePath]);
    // Race condition: outro certificado ativo já existe
    if (insertError.message.includes("duplicate") || insertError.message.includes("unique")) {
      throw Errors.conflict("Já existe um certificado ativo para esta empresa.");
    }
    throw Errors.upstreamUnavailable(`Falha ao salvar certificado: ${insertError.message}`);
  }

  return certificateId;
}

/**
 * Desativa certificado e remove arquivos cifrados do Storage.
 */
export async function deleteCertificate(company: Company): Promise<void> {
  // Buscar certificado ativo
  const { data: cert, error: selectError } = await supabaseAdminClient
    .from("certificates")
    .select("id, storage_path")
    .eq("company_id", company.id)
    .eq("is_active", true)
    .maybeSingle();

  if (selectError) {
    throw Errors.upstreamUnavailable("Falha ao buscar certificado para remoção.");
  }
  if (!cert) {
    throw Errors.notFound("Nenhum certificado ativo encontrado.");
  }

  // Remover do Storage
  if (cert.storage_path) {
    await supabaseAdminClient.storage.from("certificates").remove([cert.storage_path]);
  }

  // Desativar na tabela (soft delete - preserva NF-es já importadas)
  const { error: updateError } = await supabaseAdminClient
    .from("certificates")
    .update({ is_active: false })
    .eq("id", cert.id);

  if (updateError) {
    throw Errors.upstreamUnavailable("Falha ao desativar certificado.");
  }
}

/**
 * Descriptografa o PFX e a senha para uso em memória (apenas para SEFAZ sync).
 * Retorna o PFX e a senha em buffers - o chamador deve zerar após uso.
 */
export async function getDecryptedCertificate(
  company: Company,
): Promise<{ pfx: Buffer; password: string } | null> {
  const { data: cert, error } = await supabaseAdminClient
    .from("certificates")
    .select(
      `storage_path, password_ciphertext, password_iv, password_tag, key_version,
       validation_result`,
    )
    .eq("company_id", company.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !cert) {
    return null;
  }

  // Baixar PFX cifrado do Storage
  const { data: pfxData, error: downloadError } = await supabaseAdminClient.storage
    .from("certificates")
    .download(cert.storage_path);

  if (downloadError || !pfxData) {
    throw Errors.upstreamUnavailable("Falha ao baixar certificado do Storage.");
  }

  const pfxArrayBuffer = await pfxData.arrayBuffer();
  const pfxCiphertext = Buffer.from(pfxArrayBuffer);

  // Recuperar envelope do PFX do validation_result
  const validationResult = cert.validation_result as Record<string, unknown> | null;
  const pfxEnvelopeData = validationResult?.pfxEnvelope as
    | { iv: string; tag: string; keyVersion: number }
    | undefined;

  if (!pfxEnvelopeData) {
    throw Errors.upstreamUnavailable("Metadados de criptografia do PFX não encontrados.");
  }

  // Reconstruir envelopes
  const aadPfx = `${company.id}:${cert.id}:pfx`;
  const aadPassword = `${company.id}:${cert.id}:password`;

  const pfxEnvelope: EncryptedEnvelope = {
    ciphertext: pfxCiphertext,
    iv: Buffer.from(pfxEnvelopeData.iv, "base64"),
    tag: Buffer.from(pfxEnvelopeData.tag, "base64"),
    keyVersion: pfxEnvelopeData.keyVersion,
  };

  const passwordEnvelope: EncryptedEnvelope = {
    ciphertext: cert.password_ciphertext,
    iv: cert.password_iv,
    tag: cert.password_tag,
    keyVersion: cert.key_version,
  };

  // Descriptografar
  const pfxPlaintext = decrypt(pfxEnvelope, aadPfx);
  const passwordPlaintext = decrypt(passwordEnvelope, aadPassword);

  return {
    pfx: pfxPlaintext,
    password: passwordPlaintext.toString("utf8"),
  };
}