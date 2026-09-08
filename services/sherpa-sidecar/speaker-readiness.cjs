function speakerUnavailableReason({ modelReady, profileReady, embeddingReady }) {
  if (!modelReady) return '声纹模型未加载，请在模型管理中确认模型已安装并选中'
  if (!profileReady) return '尚未注册有效声纹，请先在声纹页面录制样本'
  if (!embeddingReady) return '语音片段太短，请连续说话至少 1 秒后再试'
  return '暂时无法完成声纹验证'
}

module.exports = { speakerUnavailableReason }
