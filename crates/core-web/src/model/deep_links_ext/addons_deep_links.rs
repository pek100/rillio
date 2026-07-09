use crate::model::deep_links_ext::DeepLinksExt;
use rillio_core::deep_links::AddonsDeepLinks;

impl DeepLinksExt for AddonsDeepLinks {
    fn into_web_deep_links(self) -> Self {
        Self {
            addons: self.addons.replace("stremio://", "#"),
        }
    }
}
