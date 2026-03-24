import React from 'react';

interface Props {
  url: string;
  onClose: () => void;
}

const ImagePreview: React.FC<Props> = ({ url, onClose }) => (
  <div
    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-zoom-out"
    onClick={onClose}
  >
    <img src={url} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl" />
  </div>
);

export default ImagePreview;
