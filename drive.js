// Vercel serverless function — reads Google Drive folder and recognises contracts via AI
// Requires ANTHROPIC_API_KEY in Vercel environment variables
// Uses Google Drive public sharing — files must be in a shared folder

const FOLDER_ID = '1OYwUSOXVO38xW8vE5Sz-KvK-Lobyk5fC';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables' });
  }

  const { action, fileId, fileName } = req.body;

  try {
    if (action === 'list') {
      // List files in Drive folder using public API
      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size)&key=${process.env.GOOGLE_API_KEY || ''}`,
        { headers: { 'Accept': 'application/json' } }
      );
      
      if (!driveRes.ok) {
        // Fallback: return empty list with helpful message
        return res.status(200).json({ 
          files: [],
          message: '需要配置 Google API Key 才能列出文件'
        });
      }
      
      const driveData = await driveRes.json();
      const files = (driveData.files || []).filter(f => 
        f.mimeType === 'application/pdf' || 
        f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        f.mimeType === 'application/msword'
      );
      return res.status(200).json({ files });

    } else if (action === 'recognize') {
      // Use AI to recognize contract info from file name + any available content
      const prompt = `你是一个合同信息识别助手。根据以下合同文件名，推断合同的基本信息。

文件名：${fileName}

请返回一个JSON对象，包含以下字段：
- name: 合同名称（从文件名提取或推断，去掉文件扩展名）
- party: 对方当事人（从文件名推断，如果无法判断则留空）
- type: 合同类型，只能是以下之一：服务协议、采购合同、租赁合同、劳务合同、保密协议、其他
- start: 签署日期（YYYY-MM-DD格式，无法判断则留空）
- end: 到期日期（YYYY-MM-DD格式，无法判断则留空）
- amount: 合同金额（无法判断则留空）
- notes: 简短备注（一句话，可以留空）

只返回JSON，不要任何解释或markdown。`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const aiData = await aiRes.json();
      const text = aiData.content?.[0]?.text || '{}';
      
      try {
        const clean = text.replace(/```json|```/g, '').trim();
        const match = clean.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(match ? match[0] : clean);
        return res.status(200).json({ success: true, data: parsed });
      } catch (e) {
        return res.status(200).json({ 
          success: false, 
          data: { name: fileName.replace(/\.(pdf|docx|doc)$/i, ''), party: '', type: '其他', start: '', end: '', amount: '', notes: '' }
        });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
