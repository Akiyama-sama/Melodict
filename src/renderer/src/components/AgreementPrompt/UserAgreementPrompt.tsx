import { marked } from 'marked';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import rawAgreement from '../../../../../docs/agreement.md?raw';

/**
 * A read-only viewer for docs/agreement.md, shown inside the prompt menu from
 * Settings > About. Unlike AgreementPrompt this is just the document body — the
 * prompt menu provides the dialog shell and close button.
 */
const UserAgreementPrompt = () => {
  const { t } = useTranslation();

  const agreementHtml = useMemo(
    () =>
      // The agreement is a first-party document shipped in the repository, so rendering
      // its markdown as HTML here is safe.
      marked.parse(rawAgreement, { async: false }),
    []
  );

  return (
    <>
      <div className="mb-4 w-full text-center text-3xl font-medium">
        {t('agreementPrompt.title')}
      </div>
      <div
        className="agreement-content relative max-h-full w-full overflow-y-auto px-4 text-sm leading-6 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-medium [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-medium [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-medium [&_hr]:my-4 [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-6"
        dangerouslySetInnerHTML={{ __html: agreementHtml }}
      />
    </>
  );
};

export default UserAgreementPrompt;
